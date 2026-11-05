/**
 * Simulated intake: runs a JSON payload through the SAME validation schema and
 * ingestion rules as POST /api/v1/jobs/intake, and answers with the same
 * status codes and bodies. Nothing is received over the network: every event
 * is labelled with its origin (simulator / generator).
 */
import { PORTAL_SLUGS } from "@/lib/domain/portals";
import { INTAKE_FIELDS, intakePayloadSchema, intakeToJobRecord, toIssues } from "@/lib/jobs/schema";
import { uuidV4 } from "@/lib/uuid";

import { EngineError, ingestJob, type Ctx } from "./engine";
import { between, pick, type Rng } from "./rng";
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
import type { DemoIntegrationEvent, DemoState } from "./types";

export interface SimulatedResponse {
  status: number;
  body: Record<string, unknown>;
}

function record(
  s: DemoState,
  now: Date,
  e: Pick<
    DemoIntegrationEvent,
    "status" | "http_status" | "idempotency_key" | "job_id" | "payload" | "error" | "origin"
  >,
  requestId: string,
): DemoState {
  return {
    ...s,
    events: [
      ...s.events,
      {
        ...e,
        id: uuidV4(),
        integration: "intake",
        direction: "inbound",
        event_type: "job.intake",
        request_id: requestId,
        created_at: now.toISOString(),
      },
    ],
  };
}

export function simulateIntake(
  state: DemoState,
  now: Date,
  payload: unknown,
  origin: "simulator" | "generator",
): { state: DemoState; response: SimulatedResponse } {
  const requestId = uuidV4();
  const ctx: Ctx = { now, actorId: null, actorType: "integration" };

  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    const s = record(
      state,
      now,
      {
        status: "rejected",
        http_status: 422,
        idempotency_key: null,
        job_id: null,
        payload,
        error: "payload is not an object",
        origin,
      },
      requestId,
    );
    return {
      state: s,
      response: {
        status: 422,
        body: {
          request_id: requestId,
          status: "error",
          error: { code: "validation_failed", message: "The payload must be a single JSON object.", issues: [] },
        },
      },
    };
  }

  const parsed = intakePayloadSchema.safeParse(payload);
  if (!parsed.success) {
    const issues = toIssues(parsed.error);
    const summary = issues
      .slice(0, 5)
      .map((i) => `${i.path}: ${i.message}`)
      .join("; ");
    const s = record(
      state,
      now,
      { status: "rejected", http_status: 422, idempotency_key: null, job_id: null, payload, error: summary, origin },
      requestId,
    );
    return {
      state: s,
      response: {
        status: 422,
        body: {
          request_id: requestId,
          status: "error",
          error: { code: "validation_failed", message: "The payload failed validation.", issues },
        },
      },
    };
  }

  const data = parsed.data;
  const naturalKey = `${data.source}:${data.external_job_id}`;
  const warnings = Object.keys(payload)
    .filter((k) => !(INTAKE_FIELDS as readonly string[]).includes(k))
    .map((k) => `Unknown field "${k}" was ignored.`);

  let out;
  try {
    out = ingestJob(state, ctx, {
      job: intakeToJobRecord(data),
      contact: data.contact,
      destinations: data.destinations,
      attachments: data.attachments.map((a) => ({
        file_name: a.file_name,
        content_type: a.content_type ?? "application/octet-stream",
        size_bytes: a.size_bytes ?? null,
        blob_key: null,
        source_url: a.url,
        checksum_sha256: null,
      })),
      assignmentReason: "Listed in the intake payload destinations",
      rawPayload: payload,
      submissionToken: null,
    });
  } catch (err) {
    if (err instanceof EngineError && (err.code === "unknown_portal" || err.code === "portal_disabled")) {
      const s = record(
        state,
        now,
        {
          status: "rejected",
          http_status: 422,
          idempotency_key: naturalKey,
          job_id: null,
          payload,
          error: err.message,
          origin,
        },
        requestId,
      );
      return {
        state: s,
        response: {
          status: 422,
          body: {
            request_id: requestId,
            status: "error",
            error: {
              code: "validation_failed",
              message: "The payload failed validation.",
              issues: [{ path: "destinations", message: err.message }],
            },
          },
        },
      };
    }
    const s = record(
      state,
      now,
      {
        status: "failed",
        http_status: 500,
        idempotency_key: naturalKey,
        job_id: null,
        payload,
        error: "internal error while storing the job",
        origin,
      },
      requestId,
    );
    return {
      state: s,
      response: {
        status: 500,
        body: {
          request_id: requestId,
          status: "error",
          error: { code: "internal_error", message: "The job could not be stored. It is safe to retry." },
        },
      },
    };
  }

  const r = out.result;
  const jobBody = {
    job_id: r.job_id,
    reference: r.reference,
    source: data.source,
    external_job_id: data.external_job_id,
    job_status: r.status,
  };
  if (r.created) {
    const s = record(
      out.state,
      now,
      {
        status: "accepted",
        http_status: 201,
        idempotency_key: naturalKey,
        job_id: r.job_id,
        payload,
        error: null,
        origin,
      },
      requestId,
    );
    return {
      state: s,
      response: {
        status: 201,
        body: {
          request_id: requestId,
          status: "created",
          ...jobBody,
          destinations: r.destinations,
          routing: r.routing,
          warnings,
        },
      },
    };
  }
  if (r.payload_matches) {
    const s = record(
      out.state,
      now,
      {
        status: "duplicate",
        http_status: 200,
        idempotency_key: naturalKey,
        job_id: r.job_id,
        payload,
        error: null,
        origin,
      },
      requestId,
    );
    return {
      state: s,
      response: {
        status: 200,
        body: {
          request_id: requestId,
          status: "duplicate",
          ...jobBody,
          message: "This job was already received. Nothing was changed.",
          warnings,
        },
      },
    };
  }
  const s = record(
    out.state,
    now,
    {
      status: "duplicate",
      http_status: 409,
      idempotency_key: naturalKey,
      job_id: r.job_id,
      payload,
      error: "payload differs from the job already received; update not applied",
      origin,
    },
    requestId,
  );
  return {
    state: s,
    response: {
      status: 409,
      body: {
        request_id: requestId,
        status: "error",
        error: {
          code: "duplicate_external_job",
          message:
            "A job with this source and external_job_id was already received with different content. The update was not applied.",
          ...jobBody,
        },
      },
    },
  };
}

/* -------------------------------------------------- sample payload generator */

export interface GeneratorOptions {
  count: number;
  invalidRate: number;
  duplicateRate: number;
  /** Share of payloads without destinations (left to routing rules). */
  unroutedRate: number;
}

export function samplePayload(rng: Rng, n: number, now: Date): Record<string, unknown> {
  const category = pick(rng, CATEGORIES);
  const city = pick(rng, CITIES);
  const date = new Date(now.getTime() + between(rng, 0, 10) * 86_400_000).toISOString().slice(0, 10);
  const contactName = pick(rng, CONTACT_NAMES);
  const payload: Record<string, unknown> = {
    external_job_id: `ARO-${now.getUTCFullYear()}-${String(between(rng, 10000, 99999))}-${n}`,
    source: "aroflo",
    customer: pick(rng, CUSTOMERS),
    contact: {
      name: contactName,
      email: `${contactName.toLowerCase().replace(/[^a-z]+/g, ".")}@example.com`,
      phone: `+44 20 7946 ${String(between(rng, 1000, 9999))}`,
    },
    service_address: `${between(rng, 1, 220)} ${pick(rng, STREETS)}, ${city}`,
    category,
    priority: pick(rng, ["Low", "Normal", "Normal", "High", "High", "Urgent"] as const),
    description: pick(rng, DESCRIPTIONS[category]),
    scheduled_date: date,
    scheduled_time: `${String(between(rng, 7, 17)).padStart(2, "0")}:${pick(rng, ["00", "15", "30", "45"] as const)}`,
    destinations: [] as string[],
    attachments: [] as unknown[],
  };
  const instructions = pick(rng, INSTRUCTIONS);
  if (instructions) payload.instructions = instructions;
  const technician = pick(rng, TECHNICIANS);
  if (technician) payload.technician = technician;
  return payload;
}

const INVALIDATORS: ((p: Record<string, unknown>) => void)[] = [
  (p) => delete p.customer,
  (p) => (p.scheduled_date = "2026-02-30"),
  (p) => (p.destinations = ["northstar", "all-portals"]),
  (p) => (p.contact = { email: "not-an-email" }),
  (p) => (p.scheduled_time = "25:00"),
  (p) => (p.priority = "whenever"),
];

/** Build a realistic batch, including invalid payloads and duplicates for testing. */
export function generateIntakeBatch(rng: Rng, now: Date, opts: GeneratorOptions): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const count = Math.max(1, Math.min(100, Math.floor(opts.count)));
  for (let i = 0; i < count; i++) {
    if (out.length > 0 && rng() < opts.duplicateRate) {
      const original = pick(rng, out);
      // Half are identical replays (200), half are changed re-sends (409).
      out.push(
        rng() < 0.5
          ? structuredClone(original)
          : { ...structuredClone(original), customer: `${String(original.customer)} (revised)` },
      );
      continue;
    }
    const p = samplePayload(rng, i, now);
    if (rng() >= opts.unroutedRate) {
      const portals = [...PORTAL_SLUGS].sort(() => rng() - 0.5);
      p.destinations = portals.slice(0, rng() < 0.75 ? 1 : 2);
    }
    if (rng() < opts.invalidRate) pick(rng, INVALIDATORS)(p);
    out.push(p);
  }
  return out;
}
