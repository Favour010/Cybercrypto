import { describe, expect, it } from "vitest";

import { deriveJobStatus } from "@/lib/jobs/status";
import { parseJobsQuery } from "@/lib/jobs/query";
import { NO_ROUTE_REASON, routeJob, type RuleLike } from "@/lib/routing/rules";

import {
  EngineError,
  assignDestinations,
  cancelTask,
  createManualJob,
  markSubmittedManually,
  addUser,
  setUserActive,
  switchUser,
  updateUser,
  buildTaskPayload,
  processAutomationResult,
  startAttemptForExternalResult,
  retryTask,
  runRouting,
  saveRoutingRule,
  sendTaskToReview,
  setJobArchived,
  setWorkerRunning,
  updateJob,
  updatePortal,
  updateSettings,
  workerTick,
  type Ctx,
  type JobFieldsInput,
} from "./engine";
import { generateIntakeBatch, simulateIntake } from "./intake-sim";
import { migrateState } from "./migrate";
import { createRng } from "./rng";
import { createSeedState, HISTORY_DAYS } from "./seed";
import { analytics, attentionItems, incoming, listJobs, overview } from "./selectors";
import type { DemoState } from "./types";

const NOW = new Date("2026-11-05T15:00:00Z");

/** Seeded organisation, users, portals and rules, with no jobs. */
function emptyState(): DemoState {
  const s = createSeedState(NOW);
  return {
    ...s,
    jobs: [],
    contacts: [],
    attachments: [],
    assignments: [],
    tasks: [],
    executions: [],
    events: [],
    audit: [],
    counters: { job_reference: 0, audit: 0 },
  };
}

const admin = (s: DemoState) => s.users.find((u) => u.role === "admin")!.id;
const operator = (s: DemoState) => s.users.find((u) => u.role === "operator")!.id;
const viewer = (s: DemoState) => s.users.find((u) => u.role === "viewer")!.id;
const ctxFor = (id: string, now = NOW): Ctx => ({ now, actorId: id, actorType: "user" });

const FIELDS: JobFieldsInput = {
  customer_name: "Harbour View Apartments",
  service_address: "12 Quay Road, London",
  category: "Plumbing",
  priority: "high",
  description: "Burst pipe in plant room.",
  instructions: null,
  scheduled_date: "2026-11-06",
  scheduled_time: "09:00:00",
  technician: null,
};

function manual(
  s: DemoState,
  destinations: string[],
  fields: Partial<JobFieldsInput> = {},
  token = crypto.randomUUID(),
) {
  return createManualJob(s, ctxFor(operator(s)), {
    job: { ...FIELDS, ...fields },
    contact: { name: "Site Manager", email: null, phone: null },
    destinations,
    attachments: [],
    submissionToken: token,
  });
}

const succeed = () => 0.99; // rng → success outcome, longest durations
const tickUntilIdle = (s: DemoState, rng = succeed) => {
  let state = s;
  for (let i = 0; i < 20; i++) state = workerTick(state, new Date(NOW.getTime() + (i + 1) * 3_600_000), rng).state;
  return state;
};

describe("seed", () => {
  const s = createSeedState(NOW);

  it("is deterministic", () => {
    const again = createSeedState(NOW);
    expect(again.jobs.map((j) => j.reference)).toEqual(s.jobs.map((j) => j.reference));
    expect(again.tasks.length).toBe(s.tasks.length);
  });

  it("produces about three weeks of ~100 jobs per weekday", () => {
    expect(s.jobs.length).toBeGreaterThan(HISTORY_DAYS * 40);
    const perDay = new Map<string, number>();
    for (const j of s.jobs) perDay.set(j.received_at.slice(0, 10), (perDay.get(j.received_at.slice(0, 10)) ?? 0) + 1);
    expect(Math.max(...perDay.values())).toBeLessThanOrEqual(105);
  });

  it("respects the database's uniqueness rules", () => {
    const ext = s.jobs
      .filter((j) => j.external_job_id)
      .map((j) => `${j.organisation_id}|${j.source}|${j.external_job_id}`);
    expect(new Set(ext).size).toBe(ext.length);
    const pairs = s.tasks.map((t) => `${t.job_id}|${t.portal_slug}`);
    expect(new Set(pairs).size).toBe(pairs.length);
    expect(s.tasks.every((t) => t.idempotency_key === `${t.job_id}:${t.portal_slug}`)).toBe(true);
  });

  it("keeps every job status consistent with its tasks", () => {
    for (const j of s.jobs) {
      const tasks = s.tasks.filter((t) => t.job_id === j.id);
      expect(deriveJobStatus(tasks, j.status)).toBe(j.status);
    }
  });

  it("labels every portal run as a simulated dry run", () => {
    expect(s.executions.every((e) => e.simulated && e.mode === "dry_run" && e.confirmation_reference === null)).toBe(
      true,
    );
    expect(
      s.tasks
        .filter((t) => t.status === "submitted" && t.execution_mode === "dry_run")
        .every((t) => t.confirmation_reference === null),
    ).toBe(true);
  });

  it("only records live submissions as manual ones with a reference", () => {
    const live = s.tasks.filter((t) => t.execution_mode === "live");
    expect(live.length).toBeGreaterThan(0);
    expect(
      live.every(
        (t) => t.status === "submitted" && t.confirmation_reference && t.review_note?.startsWith("Submitted manually"),
      ),
    ).toBe(true);
  });
});

describe("routing rules", () => {
  const rules: RuleLike[] = [
    {
      id: "r1",
      name: "Fire",
      priority: 10,
      is_active: true,
      match_customer: null,
      match_category: "Fire Safety",
      match_priority: null,
      match_location: null,
      portal_slug: "greenfield",
    },
    {
      id: "r2",
      name: "Leeds",
      priority: 20,
      is_active: true,
      match_customer: null,
      match_category: null,
      match_priority: null,
      match_location: "leeds",
      portal_slug: "bluepeak",
    },
    {
      id: "r3",
      name: "Off",
      priority: 1,
      is_active: false,
      match_customer: "Any",
      match_category: null,
      match_priority: null,
      match_location: null,
      portal_slug: "apex",
    },
  ];
  const job = {
    customer_name: "Any Co",
    category: "fire safety",
    priority: "normal" as const,
    service_address: "1 Mill Lane, Leeds",
  };

  it("assigns each matching portal once, with an explained reason", () => {
    const d = routeJob(job, rules);
    expect(d.map((x) => x.portal_slug)).toEqual(["greenfield", "bluepeak"]);
    expect(d[0].reason).toBe('Rule "Fire": category is "Fire Safety"');
  });

  it("ignores inactive rules and never falls back to all portals", () => {
    expect(routeJob({ ...job, category: "Cleaning", service_address: "London" }, rules)).toEqual([]);
  });
});

describe("ingestion", () => {
  it("creates a manual job with one pending task per chosen portal", () => {
    const { state, result } = manual(emptyState(), ["northstar", "apex"]);
    expect(result).toMatchObject({ created: true, status: "ready", destinations: ["northstar", "apex"] });
    expect(state.tasks.map((t) => [t.portal_slug, t.status, t.execution_mode])).toEqual([
      ["northstar", "pending", "dry_run"],
      ["apex", "pending", "dry_run"],
    ]);
    expect(state.audit.some((a) => a.action === "jobs.created" && a.actor_id === operator(state))).toBe(true);
  });

  it("is idempotent per form submission token", () => {
    const first = manual(emptyState(), ["apex"], {}, "token-1");
    const second = manual(first.state, ["apex"], {}, "token-1");
    expect(second.result.created).toBe(false);
    expect(second.state.jobs).toHaveLength(1);
  });

  it("refuses viewers, unknown portals and disabled portals", () => {
    const s = emptyState();
    expect(() =>
      createManualJob(s, ctxFor(viewer(s)), {
        job: FIELDS,
        contact: null,
        destinations: [],
        attachments: [],
        submissionToken: "t",
      }),
    ).toThrowError(EngineError);
    expect(() => manual(s, ["everywhere"])).toThrow(/Unknown destination portal/);
    const disabled = updatePortal(s, ctxFor(admin(s)), "apex", {
      base_url: s.portals[3].base_url,
      is_enabled: false,
      automation_enabled: true,
      notes: "",
      timeout_seconds: 120,
    });
    expect(() => manual(disabled, ["apex"])).toThrow(/disabled/);
  });

  it("routes jobs without destinations by rule, or flags them for a person", () => {
    // A customer no other seeded rule matches, so only the category rule applies.
    const routed = manual(emptyState(), [], { category: "Fire Safety", customer_name: "Acme Holdings" });
    expect(routed.result).toMatchObject({ created: true, routing: "routing_rule", destinations: ["greenfield"] });
    expect(routed.state.assignments[0]).toMatchObject({ source: "routing_rule" });
    expect(routed.state.assignments[0].reason).toContain("Fire safety to Greenfield");

    const unrouted = manual(emptyState(), [], {
      category: "Cleaning",
      customer_name: "Nobody Ltd",
      service_address: "Leeds",
    });
    expect(unrouted.result).toMatchObject({
      routing: "human_review",
      status: "requires_human_review",
      destinations: [],
    });
    expect(unrouted.state.jobs[0].review_reason).toBe(NO_ROUTE_REASON);
  });

  it("leaves jobs awaiting routing when auto-routing is off, and routes them on request", () => {
    const s = { ...emptyState(), settings: { ...emptyState().settings, auto_routing: false } };
    const { state } = manual(s, [], { category: "Lift Maintenance" });
    expect(state.jobs[0].status).toBe("received");
    const r = runRouting(state, ctxFor(operator(state)));
    expect(r.routed).toBe(1);
    expect(r.state.tasks[0].portal_slug).toBe("apex");
  });
});

describe("intake simulator", () => {
  const payload = {
    external_job_id: "ARO-2026-00125",
    source: "aroflo",
    customer: "Example Facilities Ltd",
    service_address: "Example Service Address",
    category: "AC Maintenance",
    priority: "High",
    description: "Air conditioning unit requires inspection.",
    destinations: ["northstar", "bluepeak"],
  };

  it("answers like the real API: 201, then 200 duplicate, then 409 for changed content", () => {
    const a = simulateIntake(emptyState(), NOW, payload, "simulator");
    expect(a.response.status).toBe(201);
    const b = simulateIntake(a.state, NOW, { ...payload }, "simulator");
    expect(b.response).toMatchObject({ status: 200, body: { status: "duplicate" } });
    const c = simulateIntake(b.state, NOW, { ...payload, customer: "Changed" }, "simulator");
    expect(c.response.status).toBe(409);
    expect(c.state.jobs).toHaveLength(1);
    expect(c.state.jobs[0].customer_name).toBe("Example Facilities Ltd");
    expect(c.state.events.map((e) => e.status)).toEqual(["accepted", "duplicate", "duplicate"]);
  });

  it("rejects invalid payloads with field issues and records them", () => {
    const r = simulateIntake(emptyState(), NOW, { ...payload, customer: "", destinations: ["all"] }, "simulator");
    expect(r.response.status).toBe(422);
    const paths = (r.response.body.error as { issues: { path: string }[] }).issues.map((i) => i.path);
    expect(paths).toEqual(expect.arrayContaining(["customer", "destinations"]));
    expect(r.state.events[0]).toMatchObject({ status: "rejected", origin: "simulator" });
    expect(r.state.jobs).toHaveLength(0);
  });

  it("generates realistic batches with invalid payloads and duplicates", () => {
    const batch = generateIntakeBatch(createRng(7), NOW, {
      count: 100,
      invalidRate: 0.1,
      duplicateRate: 0.08,
      unroutedRate: 0.2,
    });
    expect(batch).toHaveLength(100);
    let s = emptyState();
    const codes: number[] = [];
    for (const p of batch) {
      const r = simulateIntake(s, NOW, p, "generator");
      s = r.state;
      codes.push(r.response.status);
    }
    expect(codes).toContain(201);
    expect(codes).toContain(422);
    expect(codes.some((c) => c === 200 || c === 409)).toBe(true);
    expect(s.events).toHaveLength(100);
  });
});

describe("editing", () => {
  const setup = () => manual(emptyState(), ["northstar", "bluepeak"]).state;
  const edit = (s: DemoState, over: Partial<Parameters<typeof updateJob>[2]> = {}) =>
    updateJob(s, ctxFor(operator(s)), {
      jobId: s.jobs[0].id,
      expectedUpdatedAt: s.jobs[0].updated_at,
      fields: { ...FIELDS, technician: "Tech B" },
      contact: undefined,
      addDestinations: [],
      removeDestinations: [],
      addAttachments: [],
      removeAttachmentIds: [],
      acknowledgeSubmitted: false,
      ...over,
    });

  it("saves edits and detects stale forms", () => {
    const s = setup();
    const next = edit(s).state;
    expect(next.jobs[0].technician).toBe("Tech B");
    expect(() =>
      edit(next, { expectedUpdatedAt: s.jobs[0].updated_at, fields: { ...FIELDS, technician: "Other" } }),
    ).toThrow(/changed while you were editing/);
  });

  it("requires acknowledgement once a portal has the job, and never re-queues it", () => {
    let s = setWorkerRunning(setup(), ctxFor(operator(setup())), true);
    s = tickUntilIdle(s);
    expect(s.tasks.every((t) => t.status === "submitted")).toBe(true);
    expect(() => edit(s)).toThrow(/Confirm/);
    const next = edit(s, { acknowledgeSubmitted: true }).state;
    expect(next.tasks.map((t) => t.status)).toEqual(["submitted", "submitted"]);
    expect(next.tasks.map((t) => t.attempt_count)).toEqual([1, 1]);
  });

  it("only removes destinations that were never attempted", () => {
    const s = setup();
    const removed = edit(s, { fields: FIELDS, removeDestinations: ["bluepeak"] }).state;
    expect(removed.tasks.map((t) => t.portal_slug)).toEqual(["northstar"]);
    const attempted = {
      ...s,
      tasks: s.tasks.map((t) =>
        t.portal_slug === "bluepeak" ? { ...t, attempt_count: 1, status: "retry_scheduled" as const } : t,
      ),
    };
    expect(() => edit(attempted, { fields: FIELDS, removeDestinations: ["bluepeak"] })).toThrow(
      /already been attempted/,
    );
  });

  it("locks the job while a submission is processing", () => {
    const s = setup();
    const busy = { ...s, tasks: s.tasks.map((t, i) => (i === 0 ? { ...t, status: "processing" as const } : t)) };
    expect(() => edit(busy)).toThrow(/in progress/);
    expect(() => setJobArchived(busy, ctxFor(operator(busy)), busy.jobs[0].id, true)).toThrow(/in progress/);
  });

  it("archives and restores, and viewers cannot", () => {
    const s = setup();
    expect(() => setJobArchived(s, ctxFor(viewer(s)), s.jobs[0].id, true)).toThrow(/role/);
    const archived = setJobArchived(s, ctxFor(operator(s)), s.jobs[0].id, true);
    expect(archived.jobs[0].archived_at).not.toBeNull();
    expect(setJobArchived(archived, ctxFor(operator(s)), s.jobs[0].id, false).jobs[0].archived_at).toBeNull();
  });
});

describe("simulated worker", () => {
  const many = () => {
    let s = emptyState();
    for (const [i, d] of (
      ["northstar", "northstar", "bluepeak", "apex", "metrocare", "greenfield"] as const
    ).entries()) {
      s = manual(s, [d], { priority: i === 5 ? "urgent" : "normal" }).state;
    }
    return s;
  };

  it("does nothing while paused", () => {
    const r = workerTick(many(), NOW, succeed);
    expect(r.summary.started).toBe(0);
  });

  it("respects concurrency, one attempt per portal at a time, urgent first", () => {
    const s = setWorkerRunning(many(), ctxFor(operator(many())), true);
    const r = workerTick(s, NOW, succeed);
    expect(r.summary.started).toBe(3);
    const running = r.state.executions.filter((e) => e.status === "running");
    expect(new Set(running.map((e) => e.portal_slug)).size).toBe(running.length);
    expect(running[0].portal_slug).toBe("greenfield"); // the urgent job
    expect(r.state.jobs.find((j) => j.id === running[0].job_id)!.status).toBe("processing");
  });

  it("records success as a dry run: submit skipped, no reference", () => {
    const s = tickUntilIdle(setWorkerRunning(many(), ctxFor(operator(many())), true));
    expect(
      s.tasks.every(
        (t) => t.status === "submitted" && t.execution_mode === "dry_run" && t.confirmation_reference === null,
      ),
    ).toBe(true);
    const e = s.executions[0];
    expect(e).toMatchObject({ status: "succeeded", simulated: true, mode: "dry_run" });
    expect(e.steps.find((x) => x.key === "submit")).toMatchObject({ status: "skipped" });
    expect(s.jobs.every((j) => j.status === "submitted")).toBe(true);
  });

  it("retries with exponential backoff, then fails at the retry limit", () => {
    let s = setWorkerRunning(manual(emptyState(), ["apex"]).state, ctxFor(operator(emptyState())), true);
    s = { ...s, settings: { ...s.settings, simulation: { failure_rate: 0.9, human_review_rate: 0, speed: 0.01 } } };
    const fail = () => 0.5; // within failure band, picks a retryable failure
    s = workerTick(s, NOW, fail).state;
    // The attempt ends within a second; the 15 s backoff has not elapsed yet.
    const later = new Date(NOW.getTime() + 1_000);
    s = workerTick(s, later, fail).state;
    const t1 = s.tasks[0];
    expect(t1.status).toBe("retry_scheduled");
    const waitS = (new Date(t1.next_attempt_at!).getTime() - new Date(s.executions[0].completed_at!).getTime()) / 1000;
    expect(waitS).toBe(15); // backoff base × 2^(attempt-1)
    s = tickUntilIdle(s, fail);
    expect(s.tasks[0]).toMatchObject({ status: "failed", attempt_count: 3 });
    expect(s.executions).toHaveLength(3);
    expect(s.jobs[0].status).toBe("failed");
  });

  it("sends CAPTCHA/MFA-type failures to a person instead of retrying", () => {
    let s = setWorkerRunning(manual(emptyState(), ["apex"]).state, ctxFor(operator(emptyState())), true);
    s = { ...s, settings: { ...s.settings, simulation: { failure_rate: 0, human_review_rate: 0.5, speed: 0.01 } } };
    s = tickUntilIdle(s, () => 0.1);
    expect(s.tasks[0].status).toBe("human_review");
    expect(s.executions).toHaveLength(1);
    expect(s.jobs[0].status).toBe("requires_human_review");
  });

  it("skips archived jobs and portals with automation paused", () => {
    let s = manual(emptyState(), ["apex"]).state;
    s = manual(s, ["bluepeak"]).state;
    s = setJobArchived(s, ctxFor(operator(s)), s.jobs[0].id, true);
    s = updatePortal(s, ctxFor(admin(s)), "bluepeak", {
      base_url: s.portals[1].base_url,
      is_enabled: true,
      automation_enabled: false,
      notes: "",
      timeout_seconds: 120,
    });
    s = setWorkerRunning(s, ctxFor(operator(s)), true);
    expect(workerTick(s, NOW, succeed).summary.started).toBe(0);
  });

  it("never resubmits a successful portal when another portal fails", () => {
    let s = setWorkerRunning(manual(emptyState(), ["northstar", "apex"]).state, ctxFor(operator(emptyState())), true);
    s = tickUntilIdle(s);
    s = { ...s, tasks: s.tasks.map((t) => (t.portal_slug === "apex" ? { ...t, status: "failed" as const } : t)) };
    const retried = tickUntilIdle(retryTask(s, ctxFor(operator(s)), s.tasks.find((t) => t.portal_slug === "apex")!.id));
    const ns = retried.tasks.find((t) => t.portal_slug === "northstar")!;
    expect(ns.attempt_count).toBe(1);
    expect(retried.executions.filter((e) => e.portal_slug === "northstar")).toHaveLength(1);
    expect(() => retryTask(retried, ctxFor(operator(s)), ns.id)).toThrow(/never submits it twice/);
  });
});

describe("task actions", () => {
  const failedState = () => {
    const s = manual(emptyState(), ["apex"]).state;
    return {
      ...s,
      tasks: s.tasks.map((t) => ({ ...t, status: "failed" as const, attempt_count: 3, max_attempts: 3 })),
    };
  };

  it("retry grants one more attempt and requeues", () => {
    const before = failedState();
    const s = retryTask(before, ctxFor(operator(before)), before.tasks[0].id);
    expect(s.tasks[0]).toMatchObject({ status: "pending", max_attempts: 4 });
  });

  it("records a manual portal submission only with a valid reference", () => {
    const s = failedState();
    expect(() => markSubmittedManually(s, ctxFor(operator(s)), s.tasks[0].id, " ", "")).toThrow(/reference/);
    const done = markSubmittedManually(s, ctxFor(operator(s)), s.tasks[0].id, "APX-104233", "Called the client");
    expect(done.tasks[0]).toMatchObject({
      status: "submitted",
      execution_mode: "live",
      confirmation_reference: "APX-104233",
    });
    expect(done.jobs[0].status).toBe("submitted");
  });

  it("cancels and escalates with notes", () => {
    const s = manual(emptyState(), ["apex", "bluepeak"]).state;
    const escalated = sendTaskToReview(s, ctxFor(operator(s)), s.tasks[0].id, "Client asked to hold");
    expect(escalated.tasks[0]).toMatchObject({ status: "human_review", review_note: "Client asked to hold" });
    expect(() => sendTaskToReview(s, ctxFor(operator(s)), s.tasks[0].id, "")).toThrow(/Explain/);
    const cancelled = cancelTask(escalated, ctxFor(operator(s)), s.tasks[1].id, "Duplicate on portal");
    expect(cancelled.tasks[1].status).toBe("cancelled");
  });

  it("assigns portals to an unrouted job during review", () => {
    const { state } = manual(emptyState(), [], {
      category: "Cleaning",
      customer_name: "Nobody",
      service_address: "Nowhere",
    });
    const s = assignDestinations(
      state,
      ctxFor(operator(state)),
      state.jobs[0].id,
      ["metrocare"],
      "Contract confirmed by phone",
    );
    expect(s.jobs[0]).toMatchObject({ status: "ready", review_reason: null });
    expect(s.assignments[0]).toMatchObject({ source: "manual_override", portal_slug: "metrocare" });
  });
});

describe("configuration", () => {
  it("validates settings and requires admin", () => {
    const s = emptyState();
    const base = { ...s.settings };
    expect(() => updateSettings(s, ctxFor(operator(s)), base)).toThrow(/role/);
    expect(() => updateSettings(s, ctxFor(admin(s)), { ...base, max_concurrency: 50 })).toThrow(/Concurrency/);
    const ok = updateSettings(s, ctxFor(admin(s)), { ...base, max_concurrency: 5 });
    expect(ok.settings).toMatchObject({ max_concurrency: 5, execution_mode: "dry_run" });
    expect(ok.audit.at(-1)?.action).toBe("system_settings.updated");
  });

  it("rejects routing rules without conditions", () => {
    const s = emptyState();
    const input = {
      name: "All",
      description: "",
      priority: 1,
      is_active: true,
      match_customer: null,
      match_category: null,
      match_priority: null,
      match_location: null,
      portal_slug: "apex" as const,
    };
    expect(() => saveRoutingRule(s, ctxFor(admin(s)), null, input)).toThrow(/at least one condition/);
    expect(
      saveRoutingRule(s, ctxFor(admin(s)), null, { ...input, match_category: "Plumbing" }).routing_rules,
    ).toHaveLength(s.routing_rules.length + 1);
  });

  it("resets a portal's connection status when its URL changes", () => {
    const s = emptyState();
    const tested = {
      ...s,
      portals: s.portals.map((p) => (p.slug === "apex" ? { ...p, connection_status: "ok" as const } : p)),
    };
    const next = updatePortal(tested, ctxFor(admin(s)), "apex", {
      base_url: "https://example.com/apex",
      is_enabled: true,
      automation_enabled: true,
      notes: "",
      timeout_seconds: 120,
    });
    expect(next.portals.find((p) => p.slug === "apex")!.connection_status).toBe("untested");
    expect(() =>
      updatePortal(s, ctxFor(admin(s)), "apex", {
        base_url: "http://insecure",
        is_enabled: true,
        automation_enabled: true,
        notes: "",
        timeout_seconds: 120,
      }),
    ).toThrow(/https/);
  });
});

describe("selectors", () => {
  const s = createSeedState(NOW);

  it("filters, sorts and paginates jobs like the database query", () => {
    const all = listJobs(s, parseJobsQuery({}));
    expect(all.rows).toHaveLength(25);
    expect(all.total).toBe(s.jobs.filter((j) => !j.archived_at).length);
    const failed = listJobs(s, parseJobsQuery({ status: "failed", portal: "apex", size: "100" }));
    expect(
      failed.rows.every((r) => r.status === "failed" && r.assignments.some((a) => a.portal?.slug === "apex")),
    ).toBe(true);
    const sorted = listJobs(s, parseJobsQuery({ sort: "priority", dir: "desc" }));
    expect(sorted.rows[0].priority).toBe("urgent");
  });

  it("produces consistent overview, incoming, attention and analytics figures", () => {
    const o = overview(s, NOW);
    expect(o.counts.jobsTotal).toBe(s.jobs.filter((j) => !j.archived_at).length);
    const inc = incoming(s, "awaiting_routing", 1, true, NOW);
    expect(inc.total).toBe(inc.counts.awaiting_routing);
    const att = attentionItems(s);
    expect(att.failed.every((x) => x.task.status === "failed")).toBe(true);
    const a = analytics(s, 14, NOW);
    expect(a.daily).toHaveLength(14);
    expect(a.portals.reduce((n, p) => n + p.tasks, 0)).toBe(a.totals.tasks);
    expect(a.totals.successRate).toBeGreaterThan(0.5);
  });
});

describe("automation result processing", () => {
  /** One running dry-run attempt on Apex, plus a valid result for it. */
  const running = () => {
    let s = setWorkerRunning(manual(emptyState(), ["apex"]).state, ctxFor(operator(emptyState())), true);
    s = workerTick(s, NOW, succeed).state;
    const exec = s.executions[0];
    const result = {
      execution_id: exec.id,
      job_id: exec.job_id,
      portal: exec.portal_slug,
      execution_mode: "dry_run" as const,
      status: "dry_run_passed" as const,
      attempt: exec.attempt,
      confirmation_reference: null,
      started_at: exec.started_at,
      completed_at: new Date(NOW.getTime() + 5_000).toISOString(),
      screenshot_url: null,
      error: null,
      simulated: true,
    };
    return { s, exec, result };
  };
  const later = new Date(NOW.getTime() + 6_000);

  it("builds the task payload the worker receives, with references to files only", () => {
    const { s, exec } = running();
    const p = buildTaskPayload(s, exec)!;
    expect(p).toMatchObject({ execution_id: exec.id, execution_mode: "dry_run", attempt: 1 });
    expect(p.portal.slug).toBe("apex");
    expect(p.idempotency_key).toBe(s.tasks[0].idempotency_key);
    expect(p.job.reference).toBe(s.jobs[0].reference);
  });

  it("applies a valid dry-run result and logs it as accepted", () => {
    const { s, result } = running();
    const r = processAutomationResult(s, result, later, "simulator");
    expect(r.outcome).toMatchObject({ outcome: "applied", task_status: "submitted" });
    expect(r.state.executions[0]).toMatchObject({ status: "succeeded", confirmation_reference: null });
    expect(r.state.tasks[0]).toMatchObject({ status: "submitted", execution_mode: "dry_run" });
    expect(r.state.events.find((e) => e.integration === "worker")).toMatchObject({ status: "accepted" });
  });

  it("treats a repeated result as a duplicate and does not apply it twice", () => {
    const { s, result } = running();
    const once = processAutomationResult(s, result, later, "simulator").state;
    const twice = processAutomationResult(once, result, later, "simulator");
    expect(twice.outcome.outcome).toBe("duplicate");
    expect(twice.state.tasks[0].attempt_count).toBe(1);
  });

  it("rejects a dry run claiming a real submission", () => {
    const { s, result } = running();
    const r = processAutomationResult(
      s,
      { ...result, status: "submitted", confirmation_reference: "APX-123456" },
      later,
      "simulator",
    );
    expect(r.outcome.outcome).toBe("rejected");
    expect(r.state.tasks[0].status).toBe("processing");
    expect(r.state.events.at(-1)).toMatchObject({ status: "rejected" });
  });

  it("rejects results that do not match the execution", () => {
    const { s, result } = running();
    for (const bad of [
      { ...result, portal: "northstar" },
      { ...result, attempt: 2 },
      { ...result, execution_id: crypto.randomUUID() },
      { ...result, status: "failed" }, // failure without an error
    ]) {
      expect(processAutomationResult(s, bad, later, "simulator").outcome.outcome).toBe("rejected");
    }
  });

  it("schedules a retry for a retryable failure and sends a non-retryable one to review", () => {
    const { s, result } = running();
    const retry = processAutomationResult(
      s,
      { ...result, status: "failed", error: { code: "PORTAL_TIMEOUT", message: "Timed out.", retryable: true } },
      later,
      "simulator",
    );
    expect(retry.outcome).toMatchObject({ outcome: "applied", task_status: "retry_scheduled" });
    const review = processAutomationResult(
      s,
      { ...result, status: "needs_review", error: { code: "CAPTCHA_REQUIRED", message: "CAPTCHA.", retryable: false } },
      later,
      "simulator",
    );
    expect(review.outcome).toMatchObject({ outcome: "applied", task_status: "human_review" });
    expect(review.state.jobs[0].status).toBe("requires_human_review");
  });
});

describe("user management", () => {
  const input = { email: "New.Person@Example.com", full_name: "New Person", role: "operator" as const };

  it("lets admins add users, with unique emails", () => {
    const s0 = emptyState();
    const s = addUser(s0, ctxFor(admin(s0)), input);
    const u = s.users.at(-1)!;
    expect(u).toMatchObject({ email: "new.person@example.com", role: "operator", is_active: true });
    expect(s.audit.at(-1)).toMatchObject({ action: "user.created", entity_id: u.id });
    expect(() => addUser(s, ctxFor(admin(s)), input)).toThrow(/already has this email/);
    expect(() => addUser(s0, ctxFor(operator(s0)), input)).toThrow(EngineError);
    expect(() => addUser(s0, ctxFor(admin(s0)), { ...input, email: "nope" })).toThrow(/valid email/);
  });

  it("protects the last active admin and the admin's own account", () => {
    const s = emptyState();
    const me = admin(s);
    expect(() =>
      updateUser(s, ctxFor(me), me, { email: "ada.admin@jobsync.demo", full_name: "Ada", role: "viewer" }),
    ).toThrow(/own admin role/);
    expect(() => setUserActive(s, ctxFor(me), me, false)).toThrow(/your own account/);
    // Promote the operator, then demote the original admin: allowed, one admin remains.
    let t = updateUser(s, ctxFor(me), operator(s), {
      email: "oscar.operator@jobsync.demo",
      full_name: "Oscar Operator",
      role: "admin",
    });
    t = updateUser(t, ctxFor(operator(s)), me, {
      email: "ada.admin@jobsync.demo",
      full_name: "Ada Admin",
      role: "operator",
    });
    expect(t.users.filter((u) => u.role === "admin")).toHaveLength(1);
    expect(t.audit.at(-1)).toMatchObject({ action: "user.role_changed" });
  });

  it("blocks deactivated users from acting or being switched to", () => {
    const s0 = emptyState();
    const s = setUserActive(s0, ctxFor(admin(s0)), operator(s0), false);
    expect(() => switchUser(s, operator(s))).toThrow(/deactivated/);
    expect(() => manual(s, ["apex"])).toThrow(/deactivated/);
    const back = setUserActive(s, ctxFor(admin(s)), operator(s), true);
    expect(manual(back, ["apex"]).state.jobs).toHaveLength(1);
  });

  it("upgrades saved version 1 state and rejects unknown versions", () => {
    const s = emptyState();
    const v1 = {
      ...s,
      version: 1,
      users: s.users.map((u) => ({ id: u.id, email: u.email, full_name: u.full_name, role: u.role })),
    };
    const migrated = migrateState(v1)!;
    expect(migrated.version).toBe(2);
    expect(migrated.users.every((u) => u.is_active && u.created_at === s.seeded_at)).toBe(true);
    expect(migrateState({ ...s, version: 99 })).toBeNull();
    expect(migrateState(null)).toBeNull();
  });
});

describe("sample data generator", () => {
  it("is deterministic per seed and scales with the chosen size", () => {
    const a = createSeedState(NOW, 7, { historyDays: 5, weekdayVolume: 20 });
    const b = createSeedState(NOW, 7, { historyDays: 5, weekdayVolume: 20 });
    expect(a.jobs.map((j) => j.reference)).toEqual(b.jobs.map((j) => j.reference));
    expect(a.jobs.length).toBeLessThan(120);
    const big = createSeedState(NOW, 7, { historyDays: 30, weekdayVolume: 150 });
    expect(big.jobs.length).toBeGreaterThan(a.jobs.length * 10);
    expect(big.executions.every((e) => e.simulated)).toBe(true);
  });

  it("clamps out-of-range options", () => {
    const s = createSeedState(NOW, 7, { historyDays: 999, weekdayVolume: -5 });
    const oldest = s.jobs.reduce((m, j) => (j.received_at < m ? j.received_at : m), NOW.toISOString());
    expect(NOW.getTime() - Date.parse(oldest)).toBeLessThanOrEqual(60 * 86_400_000);
  });
});

describe("external result attempts", () => {
  it("waits for a posted result; the simulated worker never finishes it", () => {
    let s = manual(emptyState(), ["apex"]).state;
    const out = startAttemptForExternalResult(s, ctxFor(admin(s)), s.tasks[0].id);
    s = setWorkerRunning(out.state, ctxFor(admin(s)), true);
    s = tickUntilIdle(s);
    expect(s.executions).toHaveLength(1);
    expect(s.executions[0]).toMatchObject({ status: "running", plan: null });
    expect(() => startAttemptForExternalResult(s, ctxFor(admin(s)), s.tasks[0].id)).toThrow(EngineError);
    expect(() => startAttemptForExternalResult(out.state, ctxFor(operator(s)), s.tasks[0].id)).toThrow(/role/);

    const e = s.executions[0];
    const result = {
      execution_id: e.id,
      job_id: e.job_id,
      portal: e.portal_slug,
      execution_mode: "dry_run",
      status: "dry_run_passed",
      attempt: 1,
      confirmation_reference: null,
      started_at: e.started_at,
      completed_at: e.started_at,
      screenshot_url: null,
      error: null,
      simulated: false,
    };
    const unmarked = processAutomationResult(s, result, NOW, "simulator");
    expect(unmarked.outcome).toMatchObject({ outcome: "rejected" });
    const ok = processAutomationResult(s, { ...result, simulated: true }, NOW, "simulator");
    expect(ok.outcome).toMatchObject({ outcome: "applied", task_status: "submitted", job_status: "submitted" });
  });
});
