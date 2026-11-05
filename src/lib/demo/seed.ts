/**
 * Deterministic seed for the demo data layer: ~3 weeks of realistic activity
 * for one organisation. Every portal run is a SIMULATED dry run (no portal was
 * contacted); a few tasks are "submitted manually" with an operator-entered
 * reference, exactly as a person resolving a review would record them.
 */
import { PORTALS, type PortalSlug } from "@/lib/domain/portals";
import type { JobPriority, JobStatus, TaskStatus } from "@/lib/domain/status";
import { backoffSeconds, deriveJobStatus } from "@/lib/jobs/status";
import { PORTAL_SPECS, SIMULATED_FAILURES } from "@/lib/portals/specs";
import { routeJob } from "@/lib/routing/rules";

import { between, createRng, pick, rngId, type Rng } from "./rng";
import {
  CATEGORIES,
  CITIES,
  CONTACT_NAMES,
  CUSTOMERS,
  DESCRIPTIONS,
  INSTRUCTIONS,
  STREETS,
  TECHNICIANS,
} from "./sample-data";
import {
  DEMO_STATE_VERSION,
  type DemoAssignment,
  type DemoAuditEntry,
  type DemoExecution,
  type DemoIntegrationEvent,
  type DemoJob,
  type DemoRoutingRule,
  type DemoState,
  type DemoTask,
} from "./types";

export const DEFAULT_SEED = 20261105;
export const HISTORY_DAYS = 21;
const DAY = 86_400_000;
const MIN = 60_000;

const PORTAL_WEIGHT: Record<PortalSlug, number> = {
  northstar: 0.3,
  bluepeak: 0.24,
  greenfield: 0.18,
  apex: 0.16,
  metrocare: 0.12,
};

function weightedPortal(rng: Rng): PortalSlug {
  let r = rng();
  for (const p of PORTALS) {
    r -= PORTAL_WEIGHT[p.slug];
    if (r <= 0) return p.slug;
  }
  return "northstar";
}

export interface SeedOptions {
  /** Days of history, including today (1–60). */
  historyDays?: number;
  /** Typical jobs received on a weekday (weekends get ~40%). 1–300. */
  weekdayVolume?: number;
}

export const SEED_LIMITS = { historyDays: [1, 60], weekdayVolume: [1, 300] } as const;
export const DEFAULT_WEEKDAY_VOLUME = 92;

export function createSeedState(now: Date = new Date(), seed = DEFAULT_SEED, options: SeedOptions = {}): DemoState {
  const clamp = (v: number | undefined, [lo, hi]: readonly [number, number], d: number) =>
    Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v!))) : d;
  const days = clamp(options.historyDays, SEED_LIMITS.historyDays, HISTORY_DAYS);
  const volume = clamp(options.weekdayVolume, SEED_LIMITS.weekdayVolume, DEFAULT_WEEKDAY_VOLUME);
  const rng = createRng(seed);
  const id = () => rngId(rng);
  const at = (ms: number) => new Date(ms).toISOString();
  const nowMs = now.getTime();
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - (days - 1) * DAY;
  const seededAt = at(start - 2 * DAY);

  const organisation = { id: id(), name: "Default organisation", slug: "default" };
  const users = [
    {
      id: id(),
      email: "ada.admin@jobsync.demo",
      full_name: "Ada Admin",
      role: "admin" as const,
      is_active: true,
      created_at: seededAt,
    },
    {
      id: id(),
      email: "oscar.operator@jobsync.demo",
      full_name: "Oscar Operator",
      role: "operator" as const,
      is_active: true,
      created_at: seededAt,
    },
    {
      id: id(),
      email: "vera.viewer@jobsync.demo",
      full_name: "Vera Viewer",
      role: "viewer" as const,
      is_active: true,
      created_at: seededAt,
    },
  ];
  const [admin, operator] = users;

  const portals = PORTALS.map((p) => ({
    id: id(),
    slug: p.slug,
    name: p.name,
    base_url: p.demoUrl,
    environment: "demo" as const,
    is_enabled: true,
    automation_enabled: true,
    connection_status: "untested" as const,
    last_connection_test_at: null,
    last_connection_error: null,
    last_connection_latency_ms: null,
    last_connection_http_status: null,
    notes: "Simulated demonstration portal (not a production customer system).",
    timeout_seconds: 120,
    created_at: seededAt,
    updated_at: seededAt,
  }));

  const rule = (
    name: string,
    priority: number,
    portal: PortalSlug,
    m: Partial<DemoRoutingRule>,
    description: string,
  ): DemoRoutingRule => ({
    id: id(),
    name,
    description,
    priority,
    is_active: true,
    match_customer: null,
    match_category: null,
    match_priority: null,
    match_location: null,
    portal_slug: portal,
    created_by: admin.id,
    created_at: seededAt,
    updated_at: seededAt,
    ...m,
  });
  const routing_rules: DemoRoutingRule[] = [
    rule(
      "Fire safety to Greenfield",
      10,
      "greenfield",
      { match_category: "Fire Safety" },
      "Greenfield holds the fire-safety maintenance contract.",
    ),
    rule("Lifts to Apex", 20, "apex", { match_category: "Lift Maintenance" }, "Apex manages all lift contracts."),
    rule(
      "Kingsbridge Medical to MetroCare",
      30,
      "metrocare",
      { match_customer: "Kingsbridge" },
      "Healthcare client, raised through MetroCare.",
    ),
    rule(
      "Manchester sites to BluePeak",
      40,
      "bluepeak",
      { match_location: "Manchester" },
      "BluePeak covers the Manchester region.",
    ),
    rule(
      "Urgent electrical to Northstar",
      50,
      "northstar",
      { match_category: "Electrical", match_priority: "urgent" },
      "Northstar runs the 24/7 electrical response desk.",
    ),
    rule(
      "Harbour View to Northstar",
      60,
      "northstar",
      { match_customer: "Harbour View" },
      "Residential client managed through Northstar.",
    ),
  ];

  const jobs: DemoJob[] = [];
  const contacts: DemoState["contacts"] = [];
  const attachments: DemoState["attachments"] = [];
  const assignments: DemoAssignment[] = [];
  const tasks: DemoTask[] = [];
  const executions: DemoExecution[] = [];
  const events: DemoIntegrationEvent[] = [];
  const audit: DemoAuditEntry[] = [];
  let ref = 0;
  let auditId = 0;
  const log = (
    createdAt: string,
    action: string,
    entityType: string,
    entityId: string | null,
    actorId: string | null,
    actorType: DemoAuditEntry["actor_type"],
    changes: Record<string, unknown> | null,
  ) =>
    audit.push({
      id: ++auditId,
      actor_id: actorId,
      actor_type: actorType,
      action,
      entity_type: entityType,
      entity_id: entityId,
      changes,
      created_at: createdAt,
    });

  for (const r of routing_rules)
    log(seededAt, "routing_rules.created", "routing_rules", r.id, admin.id, "user", {
      name: r.name,
      portal_slug: r.portal_slug,
    });
  log(seededAt, "system_settings.updated", "system_settings", null, admin.id, "user", {
    max_concurrency: { from: null, to: 3 },
    retry_limit: { from: null, to: 3 },
  });

  const failuresRetryable = SIMULATED_FAILURES.filter((f) => f.retryable);
  const failuresReview = SIMULATED_FAILURES.filter((f) => !f.retryable);

  for (let day = 0; day < days; day++) {
    const dayStart = start + day * DAY;
    const isToday = day === days - 1;
    const weekday = new Date(dayStart).getUTCDay();
    const base =
      weekday === 0 || weekday === 6
        ? between(rng, Math.round(volume * 0.33), Math.round(volume * 0.49))
        : between(rng, Math.round(volume * 0.87), Math.round(volume * 1.14));
    const fraction = isToday ? Math.max(0.05, (nowMs - dayStart) / DAY) : 1;
    const count = Math.max(isToday ? 6 : 1, Math.round(base * fraction));

    for (let n = 0; n < count; n++) {
      const receivedMs = Math.min(dayStart + Math.floor(rng() * DAY * fraction), nowMs - 2 * MIN);
      const received = at(receivedMs);
      const external = rng() < 0.88;
      const category = pick(rng, CATEGORIES);
      const customer = pick(rng, CUSTOMERS);
      const city = pick(rng, CITIES);
      const priority = pick(rng, [
        "low",
        "normal",
        "normal",
        "normal",
        "high",
        "high",
        "urgent",
      ] as const) as JobPriority;
      const hoursAhead = between(rng, 2, 96);
      const scheduled = new Date(receivedMs + hoursAhead * 3_600_000);
      const contactName = pick(rng, CONTACT_NAMES);
      ref += 1;
      const job: DemoJob = {
        id: id(),
        reference: `JS-${String(ref).padStart(6, "0")}`,
        organisation_id: organisation.id,
        source_type: external ? "external" : "manual",
        source: external ? "aroflo" : "manual",
        external_job_id: external
          ? `ARO-${new Date(receivedMs).getUTCFullYear()}-${String(10000 + ref).padStart(5, "0")}`
          : null,
        customer_name: customer,
        service_address: `${between(rng, 1, 220)} ${pick(rng, STREETS)}, ${city}`,
        category,
        priority,
        description: pick(rng, DESCRIPTIONS[category]),
        instructions: pick(rng, INSTRUCTIONS),
        scheduled_date: scheduled.toISOString().slice(0, 10),
        scheduled_time: `${String(between(rng, 7, 17)).padStart(2, "0")}:${pick(rng, ["00", "30"] as const)}:00`,
        technician: pick(rng, TECHNICIANS),
        status: "received",
        review_reason: null,
        received_at: received,
        archived_at: null,
        archived_by: null,
        created_by: external ? null : pick(rng, [admin.id, operator.id]),
        raw_payload: null,
        submission_token: external ? null : id(),
        created_at: received,
        updated_at: received,
      };
      if (external) {
        job.raw_payload = {
          external_job_id: job.external_job_id,
          source: "aroflo",
          customer: job.customer_name,
          contact: { name: contactName, email: `${contactName.toLowerCase().replace(/[^a-z]+/g, ".")}@example.com` },
          service_address: job.service_address,
          category,
          priority,
          description: job.description,
          scheduled_date: job.scheduled_date,
        };
      }
      jobs.push(job);
      if (rng() < 0.85) {
        contacts.push({
          id: id(),
          job_id: job.id,
          name: contactName,
          email: `${contactName.toLowerCase().replace(/[^a-z]+/g, ".")}@example.com`,
          phone: rng() < 0.7 ? `+44 20 7946 ${String(between(rng, 1000, 9999))}` : null,
          is_primary: true,
          created_at: received,
        });
      }
      if (external && rng() < 0.22) {
        attachments.push({
          id: id(),
          job_id: job.id,
          file_name: `site-photo-${ref}.jpg`,
          content_type: "image/jpeg",
          size_bytes: between(rng, 80_000, 2_400_000),
          blob_key: null,
          source_url: `https://files.example.com/aroflo/${job.external_job_id}/site-photo.jpg`,
          checksum_sha256: null,
          uploaded_by: null,
          created_at: received,
        });
      }
      log(received, "jobs.created", "jobs", job.id, job.created_by, external ? "integration" : "user", {
        reference: job.reference,
        source_type: job.source_type,
        source: job.source,
        external_job_id: job.external_job_id,
        customer_name: job.customer_name,
      });
      if (external) {
        events.push({
          id: id(),
          integration: "intake",
          direction: "inbound",
          event_type: "job.intake",
          status: "accepted",
          http_status: 201,
          request_id: id(),
          idempotency_key: `aroflo:${job.external_job_id}`,
          job_id: job.id,
          payload: job.raw_payload,
          error: null,
          origin: "seed",
          created_at: received,
        });
        if (rng() < 0.04) {
          const changed = rng() < 0.4;
          events.push({
            id: id(),
            integration: "intake",
            direction: "inbound",
            event_type: "job.intake",
            status: "duplicate",
            http_status: changed ? 409 : 200,
            request_id: id(),
            idempotency_key: `aroflo:${job.external_job_id}`,
            job_id: job.id,
            payload: changed ? { ...(job.raw_payload as object), customer: `${customer} (revised)` } : job.raw_payload,
            error: changed ? "payload differs from the job already received; update not applied" : null,
            origin: "seed",
            created_at: at(Math.min(receivedMs + between(rng, 1, 30) * MIN, nowMs - MIN)),
          });
        }
      }

      // Destinations: explicit (70%), routing rules (22%), none yet (8%).
      const mode = rng();
      const decided: { slug: PortalSlug; source: DemoAssignment["source"]; reason: string; ruleId: string | null }[] =
        [];
      if (mode < 0.7) {
        const first = weightedPortal(rng);
        decided.push({
          slug: first,
          source: "explicit",
          reason: external ? "Listed in the intake payload destinations" : "Selected on the Create Job form",
          ruleId: null,
        });
        if (rng() < 0.25) {
          const second = weightedPortal(rng);
          if (second !== first)
            decided.push({ slug: second, source: "explicit", reason: decided[0].reason, ruleId: null });
        }
      } else if (mode < 0.92 || !isToday) {
        for (const d of routeJob(job, routing_rules))
          decided.push({ slug: d.portal_slug, source: "routing_rule", reason: d.reason, ruleId: d.rule_id });
        if (decided.length === 0) {
          if (day < days - 2) {
            // Older unmatched jobs were resolved by an operator during human review.
            decided.push({
              slug: weightedPortal(rng),
              source: "manual_override",
              reason: "Assigned during human review: no routing rule matched",
              ruleId: null,
            });
          } else {
            job.status = "requires_human_review";
            job.review_reason = "No active routing rule matched this job. Assign destination portals manually.";
          }
        }
      }

      const jobTasks: DemoTask[] = [];
      for (const d of decided) {
        const assignment: DemoAssignment = {
          id: id(),
          job_id: job.id,
          portal_slug: d.slug,
          source: d.source,
          routing_rule_id: d.ruleId,
          reason: d.reason,
          assigned_by: job.created_by,
          created_at: received,
        };
        assignments.push(assignment);
        const task: DemoTask = {
          id: id(),
          job_id: job.id,
          portal_slug: d.slug,
          assignment_id: assignment.id,
          status: "pending",
          execution_mode: "dry_run",
          idempotency_key: `${job.id}:${d.slug}`,
          attempt_count: 0,
          max_attempts: 3,
          next_attempt_at: null,
          locked_by: null,
          locked_at: null,
          started_at: null,
          completed_at: null,
          last_error: null,
          confirmation_reference: null,
          review_note: null,
          created_at: received,
          updated_at: received,
        };

        // Recent tasks have not been picked up yet; older ones ran to completion.
        const ageMin = (nowMs - receivedMs) / MIN;
        if (ageMin < 150 + rng() * 60) {
          jobTasks.push(task);
          tasks.push(task);
          continue;
        }
        let clock = receivedMs + between(rng, 1, 18) * MIN;
        let final: TaskStatus = "pending";
        for (let attempt = 1; attempt <= task.max_attempts; attempt++) {
          if (clock > nowMs - MIN) break;
          const spec = PORTAL_SPECS[d.slug];
          const durationMs = between(rng, spec.typicalSeconds[0], spec.typicalSeconds[1]) * 1000;
          const r = rng();
          const outcome = r < 0.025 ? "review" : r < 0.025 + (attempt === 1 ? 0.13 : 0.3) ? "retry" : "success";
          const fail =
            outcome === "review"
              ? pick(rng, failuresReview)
              : outcome === "retry"
                ? pick(rng, failuresRetryable)
                : null;
          executions.push({
            id: id(),
            task_id: task.id,
            job_id: job.id,
            portal_slug: d.slug,
            attempt,
            mode: "dry_run",
            status: outcome === "success" ? "succeeded" : "failed",
            worker_id: `sim-worker-${between(rng, 1, 3)}`,
            started_at: at(clock),
            completed_at: at(clock + durationMs),
            duration_ms: durationMs,
            confirmation_reference: null,
            screenshot_path: null,
            error_code: fail?.code ?? null,
            error_message: fail?.message ?? null,
            steps: [],
            simulated: true,
            plan: null,
          });
          task.attempt_count = attempt;
          task.started_at ??= at(clock);
          task.updated_at = at(clock + durationMs);
          if (outcome === "success") {
            final = "submitted";
            task.completed_at = at(clock + durationMs);
            task.last_error = null;
            break;
          }
          task.last_error = `${fail!.code}: ${fail!.message}`;
          if (outcome === "review") {
            final = "human_review";
            break;
          }
          if (attempt === task.max_attempts) {
            final = "failed";
            task.last_error += ` (retry limit of ${task.max_attempts} reached)`;
            task.completed_at = at(clock + durationMs);
            break;
          }
          final = "retry_scheduled";
          clock += durationMs + backoffSeconds(attempt, 600) * 1000 * between(rng, 1, 3);
          task.next_attempt_at = at(clock);
        }
        task.status = final;
        if (final !== "retry_scheduled") task.next_attempt_at = null;
        // Older reviews were often resolved by a person on the portal itself.
        if (final === "human_review" && day < days - 3 && rng() < 0.6) {
          task.status = "submitted";
          task.execution_mode = "live";
          task.confirmation_reference = `${PORTAL_SPECS[d.slug].referencePattern.split("-")[0]}-${between(rng, 10000, 99999)}`;
          task.review_note = "Submitted manually on the portal by Oscar Operator";
          task.completed_at = at(
            Math.min(new Date(task.updated_at).getTime() + between(rng, 30, 240) * MIN, nowMs - MIN),
          );
          log(
            task.completed_at,
            "submission_tasks.submitted_manually",
            "submission_tasks",
            task.id,
            operator.id,
            "user",
            { portal: d.slug, confirmation_reference: task.confirmation_reference },
          );
        }
        jobTasks.push(task);
        tasks.push(task);
      }

      job.status = deriveJobStatus(jobTasks, job.status) as JobStatus;
      if (job.status === "requires_human_review" && !job.review_reason)
        job.review_reason = "A portal submission needs human review.";
      const last = jobTasks
        .map((t) => t.updated_at)
        .sort()
        .at(-1);
      if (last) job.updated_at = last;
      if (!isToday && day < days - 7 && rng() < 0.02) {
        job.archived_at = at(receivedMs + 3 * DAY);
        job.archived_by = admin.id;
        log(job.archived_at, "jobs.archived", "jobs", job.id, admin.id, "user", null);
      }
    }

    // Rejected requests that never became jobs.
    const rejected = isToday ? between(rng, 0, 2) : between(rng, 0, 3);
    for (let k = 0; k < rejected; k++) {
      const t = Math.min(dayStart + Math.floor(rng() * DAY * fraction), nowMs - MIN);
      const variant = pick(rng, [
        {
          payload: {
            external_job_id: `ARO-BAD-${day}${k}`,
            source: "aroflo",
            service_address: "12 Mill Lane, Leeds",
            category: "Plumbing",
            description: "Leak",
          },
          error: "customer: customer is required.",
        },
        {
          payload: {
            external_job_id: `ARO-BAD-${day}${k}`,
            source: "aroflo",
            customer: "Northgate Retail Park",
            service_address: "4 Market Square, Bristol",
            category: "Electrical",
            description: "Lights out",
            scheduled_date: "2026-02-30",
          },
          error: "scheduled_date: Scheduled date must be a valid date (YYYY-MM-DD).",
        },
        {
          payload: {
            external_job_id: `ARO-BAD-${day}${k}`,
            source: "aroflo",
            customer: "Oakwood Business Centre",
            service_address: "9 Kings Way, London",
            category: "Cleaning",
            description: "Deep clean",
            destinations: ["all"],
          },
          error:
            'destinations: Unknown destination portal "all". Valid portals: northstar, bluepeak, greenfield, apex, metrocare.',
        },
      ]);
      events.push({
        id: id(),
        integration: "intake",
        direction: "inbound",
        event_type: "job.intake",
        status: "rejected",
        http_status: 422,
        request_id: id(),
        idempotency_key: null,
        job_id: null,
        payload: variant.payload,
        error: variant.error,
        origin: "seed",
        created_at: at(t),
      });
    }
    if (rng() < 0.12) {
      events.push({
        id: id(),
        integration: "intake",
        direction: "inbound",
        event_type: "job.intake",
        status: "failed",
        http_status: 500,
        request_id: id(),
        idempotency_key: null,
        job_id: null,
        payload: null,
        error: "internal error while storing the job (database timeout)",
        origin: "seed",
        created_at: at(Math.min(dayStart + Math.floor(rng() * DAY * fraction), nowMs - MIN)),
      });
    }
  }

  events.sort((a, b) => a.created_at.localeCompare(b.created_at));
  audit.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id);
  audit.forEach((a, i) => (a.id = i + 1));

  return {
    version: DEMO_STATE_VERSION,
    seeded_at: now.toISOString(),
    seed,
    organisation,
    users,
    current_user_id: admin.id,
    portals,
    routing_rules,
    jobs,
    contacts,
    attachments,
    assignments,
    tasks,
    executions,
    events,
    audit,
    settings: {
      execution_mode: "dry_run",
      max_concurrency: 3,
      retry_limit: 3,
      backoff_base_seconds: 15,
      execution_timeout_seconds: 120,
      polling_interval_seconds: 1,
      auto_routing: true,
      worker_running: false,
      simulation: { failure_rate: 0.12, human_review_rate: 0.03, speed: 0.1 },
    },
    integrations: {
      n8n: {
        outbound_enabled: false,
        webhook_url: "",
        events: ["task.failed", "task.needs_review"],
        secret_configured: false,
        secret_hint: null,
        last_test: null,
      },
      playwright: { controller_url: "", last_test: null },
    },
    counters: { job_reference: ref, audit: audit.length },
  };
}
