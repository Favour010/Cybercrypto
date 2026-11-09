/**
 * End-to-end tests of POST /api/v1/jobs/intake request handling against real
 * PostgreSQL. The handler is the production one; its dependencies call the
 * real SQL functions (ingest_job, consume_rate_limit) as Supabase's
 * service_role. Only the thin supabase-js adapter is not exercised here.
 */
import type { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { generateApiKey } from "@/lib/intake/api-keys";
import { handleIntakeRequest, type IntakeDeps, type IntakeOptions } from "@/lib/intake/handler";
import { MemoryRateLimiter } from "@/lib/intake/memory-rate-limit";

import { createTestDb, TEST_DATABASE_URL, type TestDb } from "./harness";
import { pgDeps } from "./intake-deps";

const EXAMPLE = {
  external_job_id: "ARO-2026-00125",
  source: "aroflo",
  customer: "Example Facilities Ltd",
  contact: { name: "John Smith", email: "john@example.com", phone: "+2348000000000" },
  service_address: "Example Service Address",
  category: "AC Maintenance",
  priority: "High",
  description: "Air conditioning unit requires inspection.",
  instructions: "Inspect the unit and upload photographic evidence.",
  scheduled_date: "2026-11-05",
  scheduled_time: "10:00",
  technician: "Technician A",
  destinations: ["northstar", "bluepeak"],
  attachments: [] as unknown[],
};

describe.skipIf(!TEST_DATABASE_URL)("POST /api/v1/jobs/intake (real PostgreSQL)", () => {
  let db: TestDb;
  let svc: Client;
  let deps: IntakeDeps;
  let orgA = "";
  let orgB = "";
  const keys = { a: "", b: "", revoked: "", expired: "", noScope: "" };
  let options: IntakeOptions;

  async function createKey(org: string, sources: string[], extra: Record<string, unknown> = {}) {
    const k = generateApiKey();
    await db.client.query(
      `insert into public.api_keys (organisation_id, name, key_prefix, key_hash, allowed_sources, scopes, revoked_at, expires_at)
       values ($1, 'test key', $2, $3, $4, $5, $6, $7)`,
      [
        org,
        k.prefix,
        k.hash,
        sources,
        extra.scopes ?? ["jobs:intake"],
        extra.revoked_at ?? null,
        extra.expires_at ?? null,
      ],
    );
    return k.key;
  }

  function post(body: unknown, init: { key?: string | null; headers?: Record<string, string>; raw?: string } = {}) {
    const headers: Record<string, string> = { "content-type": "application/json", ...init.headers };
    if (init.key !== null) headers.authorization = `Bearer ${init.key ?? keys.a}`;
    return handleIntakeRequest(
      new Request("http://jobsync.test/api/v1/jobs/intake", {
        method: "POST",
        headers,
        body: init.raw ?? JSON.stringify(body),
      }),
      deps,
      options,
    );
  }

  const job = (overrides: Record<string, unknown> = {}) => ({
    ...EXAMPLE,
    external_job_id: `ARO-${Math.random().toString(36).slice(2, 10)}`,
    ...overrides,
  });

  beforeAll(async () => {
    db = await createTestDb();
    await db.client.query("insert into public.organisations (name, slug) values ('Second org', 'second')");
    orgA = (await db.client.query("select id from public.organisations where slug = 'default'")).rows[0].id;
    orgB = (await db.client.query("select id from public.organisations where slug = 'second'")).rows[0].id;
    keys.a = await createKey(orgA, ["aroflo"]);
    keys.b = await createKey(orgB, ["aroflo"]);
    keys.revoked = await createKey(orgA, ["aroflo"], { revoked_at: new Date().toISOString() });
    keys.expired = await createKey(orgA, ["aroflo"], { expires_at: new Date(Date.now() - 60_000).toISOString() });
    keys.noScope = await createKey(orgA, ["aroflo"], { scopes: ["reports:read"] });
    svc = await db.connect("service_role");
    deps = pgDeps(svc);
  }, 120_000);

  beforeEach(() => {
    options = { ipLimiter: new MemoryRateLimiter(1000, 60_000), keyLimit: { limit: 1000, windowSeconds: 60 } };
  });

  afterAll(async () => {
    await db?.drop();
  });

  describe("accepted jobs", () => {
    it("stores the example payload with explicit destinations and pending tasks", async () => {
      const res = await post(EXAMPLE);
      const body = await res.json();
      expect(res.status).toBe(201);
      expect(res.headers.get("x-request-id")).toBe(body.request_id);
      expect(body).toMatchObject({
        status: "created",
        source: "aroflo",
        external_job_id: "ARO-2026-00125",
        job_status: "ready",
        destinations: ["northstar", "bluepeak"],
        routing: "explicit",
      });
      expect(body.reference).toMatch(/^JS-\d{6}$/);

      const { rows } = await db.client.query(
        `select j.organisation_id, j.source_type, j.source, j.external_job_id, j.priority, j.scheduled_time::text,
                j.raw_payload, j.status,
                (select json_agg(portal_slug order by portal_slug) from public.submission_tasks t where t.job_id = j.id) as tasks,
                (select json_agg(status) from public.submission_tasks t where t.job_id = j.id) as task_statuses,
                (select row_to_json(c) from (select name, email, phone, is_primary from public.job_contacts where job_id = j.id) c) as contact
         from public.jobs j where j.id = $1`,
        [body.job_id],
      );
      expect(rows[0]).toMatchObject({
        organisation_id: orgA,
        source_type: "external",
        source: "aroflo",
        external_job_id: "ARO-2026-00125",
        priority: "high",
        scheduled_time: "10:00:00",
        status: "ready",
        tasks: ["bluepeak", "northstar"],
        task_statuses: ["pending", "pending"],
        contact: { name: "John Smith", email: "john@example.com", phone: "+2348000000000", is_primary: true },
      });
      expect(rows[0].raw_payload).toEqual(EXAMPLE);
    });

    it("accepts a minimal payload with only the required fields", async () => {
      const res = await post({
        external_job_id: `MIN-${Date.now()}`,
        source: "aroflo",
        customer: "Minimal Ltd",
        service_address: "1 Short Street",
        category: "General Repairs",
        description: "Check the door closer.",
      });
      const body = await res.json();
      expect(res.status).toBe(201);
      expect(body).toMatchObject({ job_status: "received", routing: "awaiting_routing", warnings: [] });
      const { rows } = await db.client.query(
        "select priority, instructions, technician, scheduled_date from public.jobs where id = $1",
        [body.job_id],
      );
      expect(rows[0]).toEqual({ priority: "normal", instructions: null, technician: null, scheduled_date: null });
    });

    it("records an accepted integration event", async () => {
      const res = await post(job());
      const body = await res.json();
      const { rows } = await db.client.query(
        "select status, http_status, organisation_id, job_id from public.integration_events where request_id = $1",
        [body.request_id],
      );
      expect(rows).toEqual([{ status: "accepted", http_status: 201, organisation_id: orgA, job_id: body.job_id }]);
    });

    it("never sends a job to portals it was not assigned", async () => {
      const res = await post(job({ destinations: ["apex"] }));
      const body = await res.json();
      const { rows } = await db.client.query("select portal_slug from public.submission_tasks where job_id = $1", [
        body.job_id,
      ]);
      expect(rows.map((r) => r.portal_slug)).toEqual(["apex"]);
    });

    it("leaves jobs without destinations awaiting routing (no tasks)", async () => {
      const res = await post(job({ destinations: [] }));
      const body = await res.json();
      expect(res.status).toBe(201);
      expect(body).toMatchObject({ job_status: "received", destinations: [], routing: "awaiting_routing" });
      const { rows } = await db.client.query(
        "select count(*)::int as n from public.submission_tasks where job_id = $1",
        [body.job_id],
      );
      expect(rows[0].n).toBe(0);
    });

    it("normalises and de-duplicates destinations", async () => {
      const res = await post(job({ destinations: ["NorthStar", "northstar", " APEX "] }));
      expect((await res.json()).destinations).toEqual(["northstar", "apex"]);
    });

    it("stores attachment references and reports ignored fields", async () => {
      const res = await post(
        job({
          attachments: [
            {
              file_name: "unit.jpg",
              url: "https://files.example.com/unit.jpg",
              content_type: "image/jpeg",
              size_bytes: 2048,
            },
          ],
          internal_notes: "should be ignored",
        }),
      );
      const body = await res.json();
      expect(body.warnings).toEqual(['Unknown field "internal_notes" was ignored.']);
      const { rows } = await db.client.query(
        "select file_name, source_url, storage_path from public.job_attachments where job_id = $1",
        [body.job_id],
      );
      expect(rows).toEqual([
        { file_name: "unit.jpg", source_url: "https://files.example.com/unit.jpg", storage_path: null },
      ]);
    });

    it("never marks a received job as submitted", async () => {
      const { rows } = await db.client.query("select distinct status from public.jobs");
      expect(rows.every((r) => r.status === "ready" || r.status === "received")).toBe(true);
      const tasks = await db.client.query("select distinct status from public.submission_tasks");
      expect(tasks.rows.map((r) => r.status)).toEqual(["pending"]);
    });
  });

  describe("duplicates and organisations", () => {
    it("treats an identical replay as an idempotent duplicate (200)", async () => {
      const payload = job();
      const first = await (await post(payload)).json();
      // Same content, different key order: still identical.
      const reordered = Object.fromEntries(Object.entries(payload).reverse());
      const res = await post(reordered);
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body).toMatchObject({ status: "duplicate", job_id: first.job_id, reference: first.reference });
      const { rows } = await db.client.query("select count(*)::int as n from public.jobs where external_job_id = $1", [
        payload.external_job_id,
      ]);
      expect(rows[0].n).toBe(1);
    });

    it("rejects changed content for an existing external ID (409) without applying it", async () => {
      const payload = job();
      const first = await (await post(payload)).json();
      const res = await post({ ...payload, customer: "Someone Else Ltd" });
      const body = await res.json();
      expect(res.status).toBe(409);
      expect(body.error).toMatchObject({ code: "duplicate_external_job", job_id: first.job_id });
      const { rows } = await db.client.query("select customer_name from public.jobs where id = $1", [first.job_id]);
      expect(rows[0].customer_name).toBe(payload.customer);
      const ev = await db.client.query(
        "select status, http_status from public.integration_events where request_id = $1",
        [body.request_id],
      );
      expect(ev.rows[0]).toEqual({ status: "duplicate", http_status: 409 });
    });

    it("accepts the same external ID for a different organisation", async () => {
      const payload = job();
      const a = await post(payload, { key: keys.a });
      const b = await post(payload, { key: keys.b });
      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
      const [ja, jb] = [await a.json(), await b.json()];
      expect(ja.job_id).not.toBe(jb.job_id);
      const { rows } = await db.client.query(
        "select organisation_id from public.jobs where id = any($1) order by organisation_id",
        [[ja.job_id, jb.job_id]],
      );
      expect(rows.map((r) => r.organisation_id).sort()).toEqual([orgA, orgB].sort());
    });

    it("takes the organisation from the API key, never the payload", async () => {
      const res = await post(job({ organisation_id: orgB }), { key: keys.a });
      const body = await res.json();
      const { rows } = await db.client.query("select organisation_id from public.jobs where id = $1", [body.job_id]);
      expect(rows[0].organisation_id).toBe(orgA);
    });

    it("handles concurrent duplicates: one job, the other request reports duplicate", async () => {
      const payload = job();
      const svc2 = await db.connect("service_role");
      const [r1, r2] = await Promise.all([
        post(payload),
        handleIntakeRequest(
          new Request("http://jobsync.test/api/v1/jobs/intake", {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${keys.a}` },
            body: JSON.stringify(payload),
          }),
          pgDeps(svc2),
          options,
        ),
      ]);
      expect([r1.status, r2.status].sort()).toEqual([200, 201]);
      const { rows } = await db.client.query("select count(*)::int as n from public.jobs where external_job_id = $1", [
        payload.external_job_id,
      ]);
      expect(rows[0].n).toBe(1);
    });
  });

  describe("invalid payloads", () => {
    it("returns field-level issues (422) and records a rejected event", async () => {
      const res = await post(
        job({
          customer: "   ",
          contact: { email: "not-an-email" },
          scheduled_date: "2026-02-30",
          scheduled_time: "25:00",
          priority: "whenever",
        }),
      );
      const body = await res.json();
      expect(res.status).toBe(422);
      expect(body.error.code).toBe("validation_failed");
      const paths = body.error.issues.map((i: { path: string }) => i.path);
      expect(paths).toEqual(
        expect.arrayContaining(["customer", "contact.email", "scheduled_date", "scheduled_time", "priority"]),
      );
      const ev = await db.client.query(
        "select status, http_status, error from public.integration_events where request_id = $1",
        [body.request_id],
      );
      expect(ev.rows[0]).toMatchObject({ status: "rejected", http_status: 422 });
      expect(ev.rows[0].error).toContain("customer");
    });

    it("rejects unknown destination portals instead of guessing", async () => {
      const res = await post(job({ destinations: ["northstar", "all"] }));
      const body = await res.json();
      expect(res.status).toBe(422);
      expect(body.error.issues[0]).toMatchObject({ path: "destinations" });
      expect(body.error.issues[0].message).toContain('"all"');
    });

    it("rejects a disabled portal at the database", async () => {
      await db.client.query("update public.portals set is_enabled = false where slug = 'metrocare'");
      try {
        const res = await post(job({ destinations: ["metrocare"] }));
        expect(res.status).toBe(422);
        expect((await res.json()).error.issues[0].message).toContain("disabled");
      } finally {
        await db.client.query("update public.portals set is_enabled = true where slug = 'metrocare'");
      }
    });

    it("requires external_job_id and source", async () => {
      const { external_job_id: _id, source: _src, ...rest } = EXAMPLE;
      void _id;
      void _src;
      const res = await post(rest);
      const paths = (await res.json()).error.issues.map((i: { path: string }) => i.path);
      expect(paths).toEqual(expect.arrayContaining(["external_job_id", "source"]));
    });

    it("rejects non-https attachment URLs", async () => {
      const res = await post(job({ attachments: [{ file_name: "a.pdf", url: "http://insecure.example.com/a.pdf" }] }));
      expect(res.status).toBe(422);
    });

    it("rejects malformed JSON (400), non-objects (422), wrong media type (415) and oversized bodies (413)", async () => {
      expect((await post(null, { raw: "{not json" })).status).toBe(400);
      expect((await post([EXAMPLE])).status).toBe(422);
      expect((await post(EXAMPLE, { headers: { "content-type": "text/plain" } })).status).toBe(415);
      options.maxBodyBytes = 200;
      expect((await post(EXAMPLE)).status).toBe(413);
    });
  });

  describe("authentication and limits", () => {
    it("requires an API key", async () => {
      const res = await post(EXAMPLE, { key: null });
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toContain("Bearer");
    });

    it("rejects wrong, revoked and expired keys identically", async () => {
      const wrong = keys.a.slice(0, -4) + "AAAA";
      for (const key of [wrong, keys.revoked, keys.expired, "jsk_short"]) {
        const res = await post(job(), { key });
        expect(res.status, key).toBe(401);
        expect((await res.json()).error.message).toBe("A valid API key is required.");
      }
    });

    it("accepts the key via X-API-Key as well", async () => {
      const res = await post(job(), { key: null, headers: { "x-api-key": keys.a } });
      expect(res.status).toBe(201);
    });

    it("enforces the key's scope and allowed sources", async () => {
      expect((await post(job(), { key: keys.noScope })).status).toBe(403);
      const res = await post(job({ source: "servicem8" }));
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe("source_not_allowed");
    });

    it("rate-limits per key in the database (429 + Retry-After)", async () => {
      const k = await createKey(orgA, ["aroflo"]);
      options.keyLimit = { limit: 2, windowSeconds: 60 };
      expect((await post(job(), { key: k })).status).toBe(201);
      expect((await post(job(), { key: k })).status).toBe(201);
      const limited = await post(job(), { key: k });
      expect(limited.status).toBe(429);
      expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    });

    it("rate-limits per IP before touching the database", async () => {
      options.ipLimiter = new MemoryRateLimiter(1, 60_000);
      expect((await post(job(), { headers: { "x-forwarded-for": "203.0.113.9" } })).status).toBe(201);
      expect((await post(job(), { headers: { "x-forwarded-for": "203.0.113.9" } })).status).toBe(429);
    });

    it("does not let signed-in users call ingest_job or the rate limiter directly", async () => {
      await db.as("authenticated", null, async (c) => {
        await expect(c.query("select public.consume_rate_limit('x', 1, 60)")).rejects.toMatchObject({ code: "42501" });
      });
      await db.as("authenticated", null, async (c) => {
        await expect(
          c.query("select public.ingest_job($1, '{}', null, '{}', '[]', 'x', null, null, null)", [orgA]),
        ).rejects.toMatchObject({ code: "42501" });
      });
    });

    it("keeps the source system's identifiers immutable", async () => {
      const body = await (await post(job())).json();
      await expect(
        db.client.query("update public.jobs set external_job_id = 'CHANGED' where id = $1", [body.job_id]),
      ).rejects.toMatchObject({ code: "23514" });
    });
  });
});
