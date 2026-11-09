/**
 * Upstream work orders and batches (migration 0012) against real PostgreSQL:
 * the agreed flow Supabase upstream → n8n → JobSync intake API, with the
 * production intake handler standing in for the HTTP call n8n makes.
 * n8n's database access is exercised as the jobsync_upstream_n8n role.
 */
import { randomUUID } from "node:crypto";

import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { generateApiKey } from "@/lib/intake/api-keys";
import { handleIntakeRequest, type IntakeDeps, type IntakeOptions } from "@/lib/intake/handler";
import { MemoryRateLimiter } from "@/lib/intake/memory-rate-limit";

import { createTestDb, expectPgError, TEST_DATABASE_URL, type TestDb } from "./harness";
import { pgDeps } from "./intake-deps";

const N8N = "jobsync_upstream_n8n";

function workOrder(ext: string, overrides: Record<string, unknown> = {}) {
  return {
    external_job_id: ext,
    customer: "Example Facilities Ltd",
    contact: { name: "John Smith", email: "john@example.com", phone: null },
    service_address: "1 Example Road, Leeds",
    category: "AC Maintenance",
    priority: "normal",
    description: "Air conditioning unit requires inspection.",
    destinations: ["northstar"],
    ...overrides,
  };
}

interface Claimed {
  work_order_id: string;
  claim_token: string;
  organisation_id: string;
  batch_id: string;
  source: string;
  external_job_id: string;
  attempt: number;
  payload: Record<string, unknown>;
}

describe.skipIf(!TEST_DATABASE_URL)("upstream work orders and batches (real PostgreSQL)", () => {
  let db: TestDb;
  let sql: Client;
  let n8n: Client;
  let svc: Client;
  let deps: IntakeDeps;
  let apiKey = "";
  let orgA = "";
  let orgB = "";
  const options: IntakeOptions = {
    ipLimiter: new MemoryRateLimiter(100_000, 60_000),
    keyLimit: { limit: 100_000, windowSeconds: 60 },
  };

  const enqueue = async (ref: string, items: unknown[], source = "aroflo", c: Client = n8n) =>
    (await c.query("select public.upstream_enqueue_work_orders($1, $2, $3) as r", [ref, source, JSON.stringify(items)]))
      .rows[0].r as {
      batch_id: string;
      inserted: number;
      duplicates: { external_job_id: string }[];
      conflicts: { external_job_id: string }[];
    };

  const claim = async (limit = 25, batchId: string | null = null, c: Client = n8n, worker = "n8n-test") =>
    (await c.query("select * from public.upstream_claim_work_orders($1, $2, 300, $3)", [worker, limit, batchId]))
      .rows as Claimed[];

  const report = async (w: Pick<Claimed, "work_order_id" | "claim_token">, status: number | null, body: unknown) =>
    (
      await n8n.query("select public.upstream_report_delivery($1, $2, $3, $4) as r", [
        w.work_order_id,
        w.claim_token,
        status,
        body === null ? null : JSON.stringify(body),
      ])
    ).rows[0].r as { outcome: string; delivery_status: string; jobsync_reference?: string };

  /** What an n8n workflow does for one claimed record: POST it to JobSync, report the answer. */
  const deliver = async (w: Claimed) => {
    const res = await handleIntakeRequest(
      new Request("http://jobsync.test/api/v1/jobs/intake", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(w.payload),
      }),
      deps,
      options,
    );
    return { http: res.status, report: await report(w, res.status, await res.json()) };
  };

  const batchRow = async (id: string) =>
    (await sql.query("select * from public.upstream_batches where id = $1", [id])).rows[0];

  beforeAll(async () => {
    db = await createTestDb();
    sql = db.client;
    await sql.query("insert into public.organisations (name, slug) values ('Second org', 'second')");
    orgA = (await sql.query("select id from public.organisations where slug = 'default'")).rows[0].id;
    orgB = (await sql.query("select id from public.organisations where slug = 'second'")).rows[0].id;
    const k = generateApiKey();
    await sql.query(
      `insert into public.api_keys (organisation_id, name, key_prefix, key_hash, allowed_sources)
       values ($1, 'n8n', $2, $3, '{aroflo}')`,
      [orgA, k.prefix, k.hash],
    );
    apiKey = k.key;
    svc = await db.connect("service_role");
    deps = pgDeps(svc);
    n8n = await db.connect();
    await n8n.query(`set role ${N8N}`);
  }, 120_000);

  afterAll(async () => {
    await db?.drop();
  });

  describe("permissions", () => {
    it("gives n8n no access to JobSync's own tables, only the upstream tables and functions", async () => {
      const { rows } = await sql.query(
        `select c.relname from pg_class c
          where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
            and (has_table_privilege($1, c.oid, 'select') or has_table_privilege($1, c.oid, 'insert')
              or has_table_privilege($1, c.oid, 'update') or has_table_privilege($1, c.oid, 'delete'))
          order by 1`,
        [N8N],
      );
      expect(rows.map((r) => r.relname)).toEqual(["upstream_batches", "upstream_work_orders"]);
      await expectPgError(n8n.query("select 1 from public.jobs limit 1"), "42501");
      await expectPgError(
        n8n.query("insert into public.jobs (organisation_id, source_type, source) values ($1, 'manual', 'x')", [orgA]),
        "42501",
      );
      await expectPgError(
        n8n.query("select public.ingest_job($1, '{}', null, '{}', '[]', 'x', null, null, null)", [orgA]),
        "42501",
      );
    });

    it("lets n8n change upstream records only through the functions", async () => {
      const b = await enqueue(`perm-${randomUUID().slice(0, 8)}`, [workOrder(`PERM-${randomUUID()}`)]);
      await expectPgError(n8n.query("update public.upstream_work_orders set max_attempts = 9"), "42501");
      await expectPgError(n8n.query("delete from public.upstream_batches where id = $1", [b.batch_id]), "42501");
      await expectPgError(n8n.query("select public.upstream_requeue_work_orders($1, null)", [b.batch_id]), "42501");
    });

    it("keeps anon out entirely and signed-in users read-only within their organisation", async () => {
      await db.as("anon", null, async (c) => {
        await expectPgError(c.query("select 1 from public.upstream_work_orders"), "42501");
      });
      const user = async (email: string, org: string) => {
        const { rows } = await sql.query(
          "insert into auth.users (email, raw_app_meta_data) values ($1, $2) returning id",
          [email, { organisation_slug: org }],
        );
        return rows[0].id as string;
      };
      const inA = await user(`a-${randomUUID()}@example.com`, "default");
      const inB = await user(`b-${randomUUID()}@example.com`, "second");
      await enqueue(`rls-${randomUUID().slice(0, 8)}`, [workOrder(`RLS-${randomUUID()}`)]);
      const visible = async (id: string) => {
        await db.as("authenticated", id, (c) =>
          expectPgError(c.query("select public.upstream_claim_work_orders('x', 1, 300, null)"), "42501"),
        );
        return db.as(
          "authenticated",
          id,
          async (c) => (await c.query("select organisation_id from public.upstream_work_orders")).rows,
        );
      };
      const a = await visible(inA);
      expect(a.length).toBeGreaterThan(0);
      expect(a.every((r) => r.organisation_id === orgA)).toBe(true);
      expect(await visible(inB)).toEqual([]);
      await db.as("authenticated", inA, async (c) => {
        await expectPgError(c.query("update public.upstream_work_orders set max_attempts = 9"), "42501");
      });
      expect(orgB).not.toBe(orgA);
    });
  });

  describe("batches", () => {
    it("tracks a 100-record batch from pending to delivered, through the real intake API", async () => {
      const ref = `aroflo-${randomUUID().slice(0, 8)}`;
      const items = Array.from({ length: 100 }, (_, i) => workOrder(`B100-${ref}-${i}`));
      const b = await enqueue(ref, items);
      expect(b.inserted).toBe(100);
      expect(await batchRow(b.batch_id)).toMatchObject({
        total_count: 100,
        pending_count: 100,
        delivered_count: 0,
        failed_count: 0,
        status: "open",
      });

      // Enqueuing the same batch again creates nothing.
      const again = await enqueue(ref, items);
      expect(again).toMatchObject({ inserted: 0 });
      expect(again.duplicates).toHaveLength(100);

      for (let round = 0; round < 4; round++) {
        const claimed = await claim(25, b.batch_id);
        expect(claimed).toHaveLength(25);
        if (round === 0) expect(await batchRow(b.batch_id)).toMatchObject({ in_progress_count: 25, pending_count: 75 });
        for (const w of claimed) {
          const r = await deliver(w);
          expect(r.http).toBe(201);
          expect(r.report.outcome).toBe("delivered");
        }
      }
      const done = await batchRow(b.batch_id);
      expect(done).toMatchObject({
        total_count: 100,
        pending_count: 0,
        in_progress_count: 0,
        delivered_count: 100,
        failed_count: 0,
        status: "completed",
      });
      expect(done.completed_at).not.toBeNull();
      const jobs = await sql.query(
        "select count(*)::int as n from public.jobs where source = 'aroflo' and external_job_id like $1",
        [`B100-${ref}-%`],
      );
      expect(jobs.rows[0].n).toBe(100);
      const linked = await sql.query(
        `select count(*)::int as n from public.upstream_work_orders w
           join public.jobs j on j.id = w.jobsync_job_id and j.external_job_id = w.external_job_id
          where w.batch_id = $1`,
        [b.batch_id],
      );
      expect(linked.rows[0].n).toBe(100);
    });

    it("reports duplicates and conflicts instead of creating records twice", async () => {
      const ext = `DUP-${randomUUID()}`;
      await enqueue(`dup-${randomUUID().slice(0, 8)}`, [workOrder(ext)]);
      const other = await enqueue(`dup-${randomUUID().slice(0, 8)}`, [
        workOrder(ext),
        workOrder(ext, { description: "Different text." }),
      ]);
      expect(other.inserted).toBe(0);
      expect(other.duplicates.map((d) => d.external_job_id)).toEqual([ext]);
      expect(other.conflicts.map((d) => d.external_job_id)).toEqual([ext]);
    });

    it("rejects malformed input as a whole", async () => {
      const ref = `bad-${randomUUID().slice(0, 8)}`;
      await expectPgError(enqueue(ref, []), "22023");
      await expectPgError(enqueue(ref, [workOrder("")]), "22023");
      await expectPgError(enqueue(ref, [workOrder("X1", { source: "other" })]), "22023");
      await expectPgError(
        enqueue(
          ref,
          Array.from({ length: 501 }, (_, i) => workOrder(`M-${i}`)),
        ),
        "22023",
      );
      const { rows } = await sql.query(
        "select count(*)::int as n from public.upstream_batches where batch_reference = $1",
        [ref],
      );
      expect(rows[0].n).toBe(0);
      await enqueue(ref, [workOrder(`OK-${randomUUID()}`)]);
      await expectPgError(enqueue(ref, [workOrder(`OK-${randomUUID()}`)], "simpro"), "22023");
    });
  });

  describe("retry safety", () => {
    it("never hands the same record to two concurrent n8n executions", async () => {
      const ref = `conc-${randomUUID().slice(0, 8)}`;
      const b = await enqueue(
        ref,
        Array.from({ length: 40 }, (_, i) => workOrder(`CONC-${ref}-${i}`)),
      );
      const second = await db.connect();
      await second.query(`set role ${N8N}`);
      const [x, y] = await Promise.all([claim(30, b.batch_id), claim(30, b.batch_id, second, "n8n-other")]);
      const ids = [...x, ...y].map((w) => w.work_order_id);
      expect(ids).toHaveLength(40);
      expect(new Set(ids).size).toBe(40);
    });

    it("re-sends a record whose outcome was lost, and JobSync answers duplicate (one job)", async () => {
      const ext = `LOST-${randomUUID()}`;
      const b = await enqueue(`lost-${randomUUID().slice(0, 8)}`, [workOrder(ext)]);
      const [first] = await claim(1, b.batch_id);
      // n8n posts the job, then crashes before reporting back.
      const res = await handleIntakeRequest(
        new Request("http://jobsync.test/api/v1/jobs/intake", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(first.payload),
        }),
        deps,
        options,
      );
      expect(res.status).toBe(201);
      expect(await claim(1, b.batch_id)).toEqual([]); // still leased
      await sql.query(
        "update public.upstream_work_orders set lease_expires_at = now() - interval '1 second' where id = $1",
        [first.work_order_id],
      );
      const [second] = await claim(1, b.batch_id);
      expect(second.work_order_id).toBe(first.work_order_id);
      expect(second.attempt).toBe(2);
      // A late report from the first execution is ignored.
      expect((await report(first, 201, { job_id: randomUUID() })).outcome).toBe("stale_claim");
      const r = await deliver(second);
      expect(r).toMatchObject({ http: 200, report: { outcome: "delivered" } });
      expect((await report(second, 200, {})).outcome).toBe("already_delivered");
      const { rows } = await sql.query("select count(*)::int as n from public.jobs where external_job_id = $1", [ext]);
      expect(rows[0].n).toBe(1);
    });

    it("retries transient errors with backoff, fails permanent ones, and can requeue", async () => {
      const ref = `fail-${randomUUID().slice(0, 8)}`;
      const b = await enqueue(ref, [
        workOrder(`T-${ref}`),
        workOrder(`V-${ref}`, { customer: "" }), // JobSync rejects: 422
      ]);
      const claimed = await claim(2, b.batch_id);
      const transient = claimed.find((w) => w.external_job_id.startsWith("T-"))!;
      const invalid = claimed.find((w) => w.external_job_id.startsWith("V-"))!;

      const t = await report(transient, 503, { error: { code: "unavailable", message: "Database unreachable" } });
      expect(t).toMatchObject({ outcome: "retry_scheduled", delivery_status: "pending" });
      const tRow = (
        await sql.query("select * from public.upstream_work_orders where id = $1", [transient.work_order_id])
      ).rows[0];
      expect(tRow).toMatchObject({ last_error_code: "UNAVAILABLE", attempt_count: 1 });
      expect(new Date(tRow.next_attempt_at).getTime()).toBeGreaterThan(Date.now() + 20_000);
      expect(await claim(5, b.batch_id)).toEqual([]); // not due yet

      const v = await deliver(invalid);
      expect(v.http).toBe(422);
      expect(v.report).toMatchObject({ outcome: "failed", delivery_status: "failed" });
      expect(await batchRow(b.batch_id)).toMatchObject({ pending_count: 1, failed_count: 1, status: "open" });

      // Out of attempts → failed.
      await sql.query(
        "update public.upstream_work_orders set max_attempts = 1, next_attempt_at = now() where id = $1",
        [transient.work_order_id],
      );
      expect(await claim(5, b.batch_id)).toEqual([]);
      const exhausted = (
        await sql.query("select * from public.upstream_work_orders where id = $1", [transient.work_order_id])
      ).rows[0];
      expect(exhausted).toMatchObject({ delivery_status: "failed", last_error_code: "ATTEMPTS_EXHAUSTED" });
      expect(await batchRow(b.batch_id)).toMatchObject({
        failed_count: 2,
        pending_count: 0,
        status: "completed_with_failures",
      });

      // Operators requeue (service role / SQL editor), with fresh attempts.
      const moved = await svc.query("select public.upstream_requeue_work_orders($1, null) as n", [b.batch_id]);
      expect(moved.rows[0].n).toBe(2);
      expect(await batchRow(b.batch_id)).toMatchObject({ pending_count: 2, failed_count: 0, status: "open" });
      const audit = await sql.query(
        "select count(*)::int as n from public.audit_logs where action = 'upstream_work_orders.requeued' and entity_id = $1",
        [b.batch_id],
      );
      expect(audit.rows[0].n).toBe(1);
    });

    it("does not trust a success response that points at another job", async () => {
      const b = await enqueue(`mm-${randomUUID().slice(0, 8)}`, [workOrder(`MM-${randomUUID()}`)]);
      const [w] = await claim(1, b.batch_id);
      const someJob = (await sql.query("select id from public.jobs limit 1")).rows[0].id;
      expect(await report(w, 201, { job_id: someJob })).toMatchObject({ outcome: "failed" });
      const row = (await sql.query("select * from public.upstream_work_orders where id = $1", [w.work_order_id]))
        .rows[0];
      expect(row).toMatchObject({ last_error_code: "JOBSYNC_RESPONSE_MISMATCH", jobsync_job_id: null });
    });

    it("keeps delivered records and record identity immutable", async () => {
      const b = await enqueue(`imm-${randomUUID().slice(0, 8)}`, [workOrder(`IMM-${randomUUID()}`)]);
      const [w] = await claim(1, b.batch_id);
      await deliver(w);
      await expectPgError(
        sql.query("update public.upstream_work_orders set delivery_status = 'pending' where id = $1", [
          w.work_order_id,
        ]),
        "23514",
      );
      await expectPgError(
        sql.query("update public.upstream_work_orders set payload = payload || '{\"x\":1}' where id = $1", [
          w.work_order_id,
        ]),
        "23514",
      );
      await expectPgError(
        sql.query("update public.upstream_work_orders set external_job_id = 'OTHER' where id = $1", [w.work_order_id]),
        "23514",
      );
      await expectPgError(
        sql.query("update public.upstream_batches set total_count = 5 where id = $1", [b.batch_id]),
        "23514",
      );
    });
  });
});
