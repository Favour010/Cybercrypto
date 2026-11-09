/**
 * IntakeDeps backed by real PostgreSQL: the production intake handler calls
 * the real SQL functions as Supabase's service_role. Shared by the DB tests.
 */
import type { Client } from "pg";

import { IngestRejection, type IngestResult, type IntakeDeps } from "@/lib/intake/handler";

export function pgDeps(svc: Client): IntakeDeps {
  return {
    async findApiKey(prefix) {
      const { rows } = await svc.query(
        "select id, organisation_id, key_hash, allowed_sources, scopes, revoked_at, expires_at from public.api_keys where key_prefix = $1",
        [prefix],
      );
      return rows[0] ?? null;
    },
    async markApiKeyUsed(id) {
      await svc.query("update public.api_keys set last_used_at = now() where id = $1", [id]);
    },
    async consumeRateLimit(bucket, limit, windowSeconds) {
      const { rows } = await svc.query("select * from public.consume_rate_limit($1, $2, $3)", [
        bucket,
        limit,
        windowSeconds,
      ]);
      return { allowed: rows[0].allowed, retryAfterSeconds: rows[0].retry_after_seconds };
    },
    async ingest(a) {
      try {
        const { rows } = await svc.query("select public.ingest_job($1, $2, $3, $4, $5, $6, null, $7, null) as r", [
          a.organisationId,
          a.job,
          a.contact,
          a.destinations,
          JSON.stringify(a.attachments),
          a.reason,
          JSON.stringify(a.rawPayload),
        ]);
        return rows[0].r as IngestResult;
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === "JSU01") throw new IngestRejection("unknown_portal", (err as Error).message);
        if (code === "JSU02") throw new IngestRejection("portal_disabled", (err as Error).message);
        throw err;
      }
    },
    async recordEvent(e) {
      await svc.query(
        `insert into public.integration_events
           (organisation_id, integration, direction, event_type, status, http_status, idempotency_key, request_id, job_id, payload, error)
         values ($1, 'intake', 'inbound', 'job.intake', $2, $3, $4, $5, $6, $7, $8)`,
        [
          e.organisationId,
          e.status,
          e.httpStatus,
          e.idempotencyKey,
          e.requestId,
          e.jobId,
          e.payload === null ? null : JSON.stringify(e.payload),
          e.error,
        ],
      );
    },
  };
}
