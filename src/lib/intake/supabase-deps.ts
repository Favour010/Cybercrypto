import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { IngestRejection, type IngestResult, type IntakeDeps } from "@/lib/intake/handler";

/**
 * Production adapter: every call uses the service-role client, because the
 * caller is a machine authenticated by API key, not a signed-in user. The
 * organisation always comes from the verified key, never from the payload.
 */
export function createSupabaseIntakeDeps(admin: SupabaseClient): IntakeDeps {
  return {
    async findApiKey(prefix) {
      const { data, error } = await admin
        .from("api_keys")
        .select("id, organisation_id, key_hash, allowed_sources, scopes, revoked_at, expires_at")
        .eq("key_prefix", prefix)
        .maybeSingle();
      if (error) throw new Error(`api key lookup: ${error.code} ${error.message}`);
      return data;
    },

    async markApiKeyUsed(id) {
      await admin.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", id);
    },

    async consumeRateLimit(bucket, limit, windowSeconds) {
      const { data, error } = await admin
        .rpc("consume_rate_limit", { p_bucket: bucket, p_limit: limit, p_window_seconds: windowSeconds })
        .single<{ allowed: boolean; retry_after_seconds: number }>();
      if (error) throw new Error(`rate limit: ${error.code} ${error.message}`);
      return { allowed: data.allowed, retryAfterSeconds: data.retry_after_seconds };
    },

    async ingest(args) {
      const { data, error } = await admin.rpc("ingest_job", {
        p_organisation_id: args.organisationId,
        p_job: args.job,
        p_contact: args.contact,
        p_destinations: args.destinations,
        p_attachments: args.attachments,
        p_assignment_reason: args.reason,
        p_actor: null,
        p_raw_payload: args.rawPayload,
        p_submission_token: null,
      });
      if (error) {
        if (error.code === "JSU01") throw new IngestRejection("unknown_portal", error.message);
        if (error.code === "JSU02") throw new IngestRejection("portal_disabled", error.message);
        throw new Error(`ingest_job: ${error.code} ${error.message}`);
      }
      return data as IngestResult;
    },

    async recordEvent(e) {
      const { error } = await admin.from("integration_events").insert({
        organisation_id: e.organisationId,
        integration: "intake",
        direction: "inbound",
        event_type: "job.intake",
        status: e.status,
        http_status: e.httpStatus,
        idempotency_key: e.idempotencyKey,
        request_id: e.requestId,
        job_id: e.jobId,
        payload: e.payload,
        error: e.error,
      });
      if (error) throw new Error(`integration event: ${error.code} ${error.message}`);
    },
  };
}
