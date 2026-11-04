/**
 * POST /api/v1/jobs/intake — request handling, independent of Next.js and
 * Supabase so it can be tested end to end against real PostgreSQL functions.
 * The production adapter lives in ./supabase-deps.ts.
 */
import {
  INTAKE_FIELDS,
  intakePayloadSchema,
  intakeToJobRecord,
  toIssues,
  type ValidationIssue,
} from "@/lib/jobs/schema";
import { readApiKey, parseApiKey, verifyApiKey } from "@/lib/intake/api-keys";
import type { MemoryRateLimiter } from "@/lib/intake/memory-rate-limit";

export const INTAKE_SCOPE = "jobs:intake";
export const DEFAULT_MAX_BODY_BYTES = 1_048_576; // 1 MiB

export interface StoredApiKey {
  id: string;
  organisation_id: string;
  key_hash: string;
  allowed_sources: string[];
  scopes: string[];
  revoked_at: string | null;
  expires_at: string | null;
}

export interface IngestArgs {
  organisationId: string;
  job: ReturnType<typeof intakeToJobRecord>;
  contact: { name: string; email: string | null; phone: string | null } | null;
  destinations: string[];
  attachments: { file_name: string; content_type: string; size_bytes: number | null; source_url: string }[];
  reason: string;
  rawPayload: unknown;
}

export type IngestResult =
  | { created: true; job_id: string; reference: string; status: string; destinations: string[] }
  | { created: false; job_id: string; reference: string; status: string; payload_matches: boolean };

/** Thrown by `ingest` for business-rule rejections raised by the database. */
export class IngestRejection extends Error {
  constructor(
    readonly code: "unknown_portal" | "portal_disabled",
    message: string,
  ) {
    super(message);
  }
}

export interface IntakeEvent {
  organisationId: string | null;
  status: "accepted" | "duplicate" | "rejected" | "failed";
  httpStatus: number;
  requestId: string;
  idempotencyKey: string | null;
  jobId: string | null;
  payload: unknown;
  error: string | null;
}

export interface IntakeDeps {
  findApiKey(prefix: string): Promise<StoredApiKey | null>;
  markApiKeyUsed(id: string): Promise<void>;
  consumeRateLimit(
    bucket: string,
    limit: number,
    windowSeconds: number,
  ): Promise<{ allowed: boolean; retryAfterSeconds: number }>;
  ingest(args: IngestArgs): Promise<IngestResult>;
  recordEvent(event: IntakeEvent): Promise<void>;
}

export interface IntakeOptions {
  /** First-line, per-IP limiter for all traffic (in memory). */
  ipLimiter: MemoryRateLimiter;
  /** Authoritative per-key limit (database, shared by all instances). */
  keyLimit?: { limit: number; windowSeconds: number };
  maxBodyBytes?: number;
  now?: () => Date;
}

type Body = Record<string, unknown>;

function respond(status: number, requestId: string, body: Body, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ request_id: requestId, ...body }), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-request-id": requestId,
      ...headers,
    },
  });
}

function errorBody(code: string, message: string, extra: Body = {}): Body {
  return { status: "error", error: { code, message, ...extra } };
}

function clientIp(headers: Headers): string {
  return (headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip")?.trim() || "unknown").slice(
    0,
    64,
  );
}

/** Read the body without trusting Content-Length; stop past the limit. */
async function readBodyLimited(request: Request, maxBytes: number): Promise<string | "too_large"> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) return "too_large";
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return "too_large";
    }
    chunks.push(value);
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks));
}

export async function handleIntakeRequest(
  request: Request,
  deps: IntakeDeps,
  options: IntakeOptions,
): Promise<Response> {
  const requestId = crypto.randomUUID();
  const now = options.now?.() ?? new Date();
  const maxBody = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const keyLimit = options.keyLimit ?? { limit: 120, windowSeconds: 60 };
  const idempotencyHeader = request.headers.get("idempotency-key")?.trim().slice(0, 200) || null;

  const record = async (event: Omit<IntakeEvent, "requestId">) => {
    try {
      await deps.recordEvent({ ...event, requestId });
    } catch (err) {
      // Never fail the request because the event log is unavailable; log the id.
      console.error("[intake] could not record integration event", requestId, (err as Error).message);
    }
  };

  // 1. Cheap per-IP limit before any other work.
  const ip = options.ipLimiter.consume(`ip:${clientIp(request.headers)}`);
  if (!ip.allowed) {
    return respond(429, requestId, errorBody("rate_limited", "Too many requests. Slow down and retry later."), {
      "retry-after": String(ip.retryAfterSeconds),
    });
  }

  // 2. JSON only.
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^application\/json(\s*;|$)/i.test(contentType)) {
    return respond(415, requestId, errorBody("unsupported_media_type", "Send the payload as application/json."));
  }

  // 3. Authenticate. All failures look the same to the caller.
  const presented = readApiKey(request.headers);
  const unauthorized = async (reason: string, organisationId: string | null = null) => {
    await record({
      organisationId,
      status: "rejected",
      httpStatus: 401,
      idempotencyKey: null,
      jobId: null,
      payload: null,
      error: reason,
    });
    return respond(401, requestId, errorBody("unauthorized", "A valid API key is required."), {
      "www-authenticate": 'Bearer realm="jobsync-intake"',
    });
  };
  if (!presented) return unauthorized("missing API key");
  const parsedKey = parseApiKey(presented);
  if (!parsedKey) return unauthorized("malformed API key");

  let key: StoredApiKey | null;
  try {
    key = await deps.findApiKey(parsedKey.prefix);
  } catch (err) {
    console.error("[intake] API key lookup failed", requestId, (err as Error).message);
    return respond(503, requestId, errorBody("unavailable", "The intake service is temporarily unavailable."));
  }
  if (!key || !verifyApiKey(presented, key.key_hash)) return unauthorized("unknown API key");
  if (key.revoked_at) return unauthorized("revoked API key", key.organisation_id);
  if (key.expires_at && new Date(key.expires_at) <= now) return unauthorized("expired API key", key.organisation_id);
  if (!key.scopes.includes(INTAKE_SCOPE)) {
    return respond(403, requestId, errorBody("forbidden", "This API key may not submit jobs."));
  }

  // 4. Authoritative per-key rate limit.
  try {
    const rl = await deps.consumeRateLimit(`intake:key:${key.id}`, keyLimit.limit, keyLimit.windowSeconds);
    if (!rl.allowed) {
      return respond(
        429,
        requestId,
        errorBody("rate_limited", `Rate limit of ${keyLimit.limit} requests per ${keyLimit.windowSeconds}s exceeded.`),
        {
          "retry-after": String(rl.retryAfterSeconds),
        },
      );
    }
  } catch (err) {
    console.error("[intake] rate limit check failed", requestId, (err as Error).message);
    return respond(503, requestId, errorBody("unavailable", "The intake service is temporarily unavailable."));
  }
  await deps.markApiKeyUsed(key.id).catch(() => undefined);

  const org = key.organisation_id;

  // 5. Body: size, JSON, shape.
  const raw = await readBodyLimited(request, maxBody);
  if (raw === "too_large") {
    await record({
      organisationId: org,
      status: "rejected",
      httpStatus: 413,
      idempotencyKey: idempotencyHeader,
      jobId: null,
      payload: null,
      error: "payload too large",
    });
    return respond(413, requestId, errorBody("payload_too_large", `The payload must be at most ${maxBody} bytes.`));
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    await record({
      organisationId: org,
      status: "rejected",
      httpStatus: 400,
      idempotencyKey: idempotencyHeader,
      jobId: null,
      payload: null,
      error: "invalid JSON",
    });
    return respond(400, requestId, errorBody("invalid_json", "The request body is not valid JSON."));
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    await record({
      organisationId: org,
      status: "rejected",
      httpStatus: 422,
      idempotencyKey: idempotencyHeader,
      jobId: null,
      payload,
      error: "payload is not an object",
    });
    return respond(
      422,
      requestId,
      errorBody("validation_failed", "The payload must be a single JSON object.", { issues: [] }),
    );
  }

  // 6. Validate.
  const parsed = intakePayloadSchema.safeParse(payload);
  if (!parsed.success) {
    const issues = toIssues(parsed.error);
    await record({
      organisationId: org,
      status: "rejected",
      httpStatus: 422,
      idempotencyKey: idempotencyHeader,
      jobId: null,
      payload,
      error: summarise(issues),
    });
    return respond(422, requestId, errorBody("validation_failed", "The payload failed validation.", { issues }));
  }
  const data = parsed.data;
  const naturalKey = `${data.source}:${data.external_job_id}`;

  if (!key.allowed_sources.includes(data.source)) {
    await record({
      organisationId: org,
      status: "rejected",
      httpStatus: 403,
      idempotencyKey: naturalKey,
      jobId: null,
      payload,
      error: `source "${data.source}" not allowed for this key`,
    });
    return respond(
      403,
      requestId,
      errorBody("source_not_allowed", `This API key may not submit jobs for source "${data.source}".`, {
        allowed_sources: key.allowed_sources,
      }),
    );
  }

  const warnings = Object.keys(payload as object)
    .filter((k) => !(INTAKE_FIELDS as readonly string[]).includes(k))
    .map((k) => `Unknown field "${k}" was ignored.`);

  // 7. Ingest (one transaction in the database).
  let result: IngestResult;
  try {
    result = await deps.ingest({
      organisationId: org,
      job: intakeToJobRecord(data),
      contact: data.contact,
      destinations: data.destinations,
      attachments: data.attachments.map((a) => ({
        file_name: a.file_name,
        content_type: a.content_type ?? "application/octet-stream",
        size_bytes: a.size_bytes ?? null,
        source_url: a.url,
      })),
      reason: "Listed in the intake payload destinations",
      rawPayload: payload,
    });
  } catch (err) {
    if (err instanceof IngestRejection) {
      const issues: ValidationIssue[] = [{ path: "destinations", message: err.message }];
      await record({
        organisationId: org,
        status: "rejected",
        httpStatus: 422,
        idempotencyKey: naturalKey,
        jobId: null,
        payload,
        error: err.message,
      });
      return respond(422, requestId, errorBody("validation_failed", "The payload failed validation.", { issues }));
    }
    console.error("[intake] ingest failed", requestId, (err as Error).message);
    await record({
      organisationId: org,
      status: "failed",
      httpStatus: 500,
      idempotencyKey: naturalKey,
      jobId: null,
      payload,
      error: "internal error while storing the job",
    });
    return respond(500, requestId, errorBody("internal_error", "The job could not be stored. It is safe to retry."));
  }

  const jobBody = {
    job_id: result.job_id,
    reference: result.reference,
    source: data.source,
    external_job_id: data.external_job_id,
    job_status: result.status,
  };

  if (result.created) {
    await record({
      organisationId: org,
      status: "accepted",
      httpStatus: 201,
      idempotencyKey: naturalKey,
      jobId: result.job_id,
      payload,
      error: null,
    });
    return respond(201, requestId, {
      status: "created",
      ...jobBody,
      destinations: result.destinations,
      routing: result.destinations.length > 0 ? "explicit" : "awaiting_routing",
      warnings,
    });
  }

  if (result.payload_matches) {
    await record({
      organisationId: org,
      status: "duplicate",
      httpStatus: 200,
      idempotencyKey: naturalKey,
      jobId: result.job_id,
      payload,
      error: null,
    });
    return respond(200, requestId, {
      status: "duplicate",
      ...jobBody,
      message: "This job was already received. Nothing was changed.",
      warnings,
    });
  }

  await record({
    organisationId: org,
    status: "duplicate",
    httpStatus: 409,
    idempotencyKey: naturalKey,
    jobId: result.job_id,
    payload,
    error: "payload differs from the job already received; update not applied",
  });
  return respond(
    409,
    requestId,
    errorBody(
      "duplicate_external_job",
      "A job with this source and external_job_id was already received with different content. The update was not applied; edit the job in JobSync instead.",
      jobBody,
    ),
  );
}

function summarise(issues: ValidationIssue[]): string {
  const text = issues
    .slice(0, 5)
    .map((i) => `${i.path}: ${i.message}`)
    .join("; ");
  return issues.length > 5 ? `${text}; +${issues.length - 5} more` : text;
}
