import { readFileSync } from "node:fs";
import path from "node:path";

import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { OVERVIEW_QUERY_CONTRACT } from "@/lib/data/overview-contract";
import { PORTAL_SLUGS } from "@/lib/domain/portals";
import { EXECUTION_MODES, EXECUTION_STATUSES, JOB_STATUSES, TASK_STATUSES } from "@/lib/domain/status";

import { createTestDb, expectPgError, migrationFiles, TEST_DATABASE_URL, type TestDb } from "./harness";

const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";
const INSUFFICIENT_PRIVILEGE = "42501";

describe.skipIf(!TEST_DATABASE_URL)("database schema (real PostgreSQL)", () => {
  let db: TestDb;
  let sql: Client;
  const users = { admin: "", operator: "", viewer: "", outsider: "" };
  let orgA = "";
  let orgB = "";

  async function createUser(email: string, orgSlug?: string): Promise<string> {
    const { rows } = await sql.query(
      `insert into auth.users (email, raw_app_meta_data, raw_user_meta_data)
       values ($1, $2, '{"full_name":"Test User"}') returning id`,
      [email, orgSlug ? { organisation_slug: orgSlug } : {}],
    );
    return rows[0].id;
  }

  async function insertJob(overrides: Record<string, unknown> = {}, client: Client = sql): Promise<string> {
    const job = {
      organisation_id: orgA,
      source_type: "external",
      source: "aroflo",
      external_job_id: `ARO-${Math.random().toString(36).slice(2, 10)}`,
      customer_name: "Example Facilities Ltd",
      service_address: "1 Example Street",
      category: "AC Maintenance",
      priority: "high",
      description: "Air conditioning unit requires inspection.",
      ...overrides,
    };
    const cols = Object.keys(job);
    const { rows } = await client.query(
      `insert into public.jobs (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
      Object.values(job),
    );
    return rows[0].id;
  }

  async function portalId(slug: string): Promise<string> {
    const { rows } = await sql.query("select id from public.portals where slug = $1", [slug]);
    return rows[0].id;
  }

  async function assignAndQueue(jobId: string, slug: string): Promise<string> {
    const pid = await portalId(slug);
    const { rows: a } = await sql.query(
      `insert into public.job_portal_assignments (organisation_id, job_id, portal_id, source, reason)
       select organisation_id, id, $2, 'explicit', 'Listed in intake payload destinations' from public.jobs where id = $1
       returning id`,
      [jobId, pid],
    );
    const { rows: t } = await sql.query(
      `insert into public.submission_tasks (job_id, portal_id, assignment_id) values ($1, $2, $3) returning id`,
      [jobId, pid, a[0].id],
    );
    return t[0].id;
  }

  beforeAll(async () => {
    db = await createTestDb();
    sql = db.client;
    await sql.query("insert into public.organisations (name, slug) values ('Other Facilities Co', 'other')");
    orgA = (await sql.query("select id from public.organisations where slug = 'default'")).rows[0].id;
    orgB = (await sql.query("select id from public.organisations where slug = 'other'")).rows[0].id;
    users.admin = await createUser("admin@example.com");
    users.operator = await createUser("operator@example.com");
    users.viewer = await createUser("viewer@example.com");
    users.outsider = await createUser("outsider@example.com", "other");
    await sql.query("update public.profiles set role = 'admin' where id = $1", [users.admin]);
    await sql.query("update public.profiles set role = 'operator' where id = any($1)", [
      [users.operator, users.outsider],
    ]);
  }, 60_000);

  afterAll(async () => {
    await db?.drop();
  });

  describe("migrations", () => {
    it("are versioned, ordered and never drop or delete data", () => {
      const files = migrationFiles();
      expect(files.length).toBeGreaterThanOrEqual(8);
      for (const f of files) {
        const text = readFileSync(path.resolve(__dirname, "../../supabase/migrations", f), "utf8").replace(
          /--.*$/gm,
          "",
        );
        expect(text, f).not.toMatch(/\bdrop\s+(table|column|schema|type)\b/i);
        expect(text, f).not.toMatch(/\btruncate\s+(table\s+)?public\./i);
        expect(text, f).not.toMatch(/\bdelete\s+from\b/i);
      }
    });

    it("seeds the five demo portals as untested (never 'connected' by default)", async () => {
      const { rows } = await sql.query("select slug, connection_status, environment from public.portals order by slug");
      expect(rows.map((r) => r.slug).sort()).toEqual([...PORTAL_SLUGS].sort());
      expect(rows.every((r) => r.connection_status === "untested" && r.environment === "demo")).toBe(true);
    });

    it("keeps database enums identical to the TypeScript domain model", async () => {
      const enumValues = async (type: string) =>
        (await sql.query("select unnest(enum_range(null::" + type + "))::text as v")).rows.map((r) => r.v);
      expect(await enumValues("public.job_status")).toEqual([...JOB_STATUSES]);
      expect(await enumValues("public.task_status")).toEqual([...TASK_STATUSES]);
      expect(await enumValues("public.execution_mode")).toEqual([...EXECUTION_MODES]);
      expect(await enumValues("public.execution_status")).toEqual([...EXECUTION_STATUSES]);
    });
  });

  describe("dashboard query contract", () => {
    it("every column the overview reads exists", async () => {
      const { jobs, submissionTasks, automationExecutions } = OVERVIEW_QUERY_CONTRACT;
      await sql.query(
        `select ${jobs.columns} from public.${jobs.table} where ${jobs.activeFilterColumn} is null and ${jobs.timeColumn} >= now() - interval '14 days'`,
      );
      await sql.query(
        `select ${submissionTasks.columns} from public.${submissionTasks.table} where ${submissionTasks.timeColumn} >= now() - interval '14 days'`,
      );
      await sql.query(
        `select ${automationExecutions.columns} from public.${automationExecutions.table} where ${automationExecutions.timeColumn} >= now() - interval '14 days'`,
      );
    });
  });

  describe("jobs", () => {
    it("assigns a human-readable reference", async () => {
      const id = await insertJob();
      const { rows } = await sql.query("select reference from public.jobs where id = $1", [id]);
      expect(rows[0].reference).toMatch(/^JS-\d{6}$/);
    });

    it("rejects a duplicate source + external_job_id import", async () => {
      await insertJob({ external_job_id: "ARO-2026-00125" });
      await expectPgError(insertJob({ external_job_id: "ARO-2026-00125" }), UNIQUE_VIOLATION);
    });

    it("allows the same external ID from a different source", async () => {
      await insertJob({ external_job_id: "SHARED-1", source: "aroflo" });
      await expect(insertJob({ external_job_id: "SHARED-1", source: "servicem8" })).resolves.toBeTruthy();
    });

    it("allows many manual jobs without an external ID", async () => {
      await insertJob({ source_type: "manual", source: "manual", external_job_id: null });
      await expect(insertJob({ source_type: "manual", source: "manual", external_job_id: null })).resolves.toBeTruthy();
    });

    it("requires an external ID for external jobs", async () => {
      await expectPgError(insertJob({ external_job_id: null }), CHECK_VIOLATION);
    });

    it("allows only one primary contact per job", async () => {
      const id = await insertJob();
      await sql.query("insert into public.job_contacts (job_id, name, is_primary) values ($1, 'John Smith', true)", [
        id,
      ]);
      await expectPgError(
        sql.query("insert into public.job_contacts (job_id, name, is_primary) values ($1, 'Jane Doe', true)", [id]),
        UNIQUE_VIOLATION,
      );
    });
  });

  describe("submission tasks and executions", () => {
    it("fills portal_slug, organisation and a deterministic idempotency key", async () => {
      const jobId = await insertJob();
      const taskId = await assignAndQueue(jobId, "northstar");
      const { rows } = await sql.query(
        "select portal_slug, organisation_id, idempotency_key, status, execution_mode from public.submission_tasks where id = $1",
        [taskId],
      );
      expect(rows[0]).toMatchObject({
        portal_slug: "northstar",
        organisation_id: orgA,
        idempotency_key: `${jobId}:northstar`,
        status: "pending",
        execution_mode: "dry_run",
      });
    });

    it("prevents a second task for the same job and portal", async () => {
      const jobId = await insertJob();
      await assignAndQueue(jobId, "bluepeak");
      await expectPgError(assignAndQueue(jobId, "bluepeak"), UNIQUE_VIOLATION);
    });

    it("refuses to record a LIVE submission without a confirmation reference", async () => {
      const taskId = await assignAndQueue(await insertJob(), "apex");
      await expectPgError(
        sql.query(
          "update public.submission_tasks set status = 'submitted', execution_mode = 'live', completed_at = now() where id = $1",
          [taskId],
        ),
        CHECK_VIOLATION,
      );
    });

    it("never resets a submitted task, even when another portal fails", async () => {
      const jobId = await insertJob();
      const ok = await assignAndQueue(jobId, "greenfield");
      const failed = await assignAndQueue(jobId, "metrocare");
      await sql.query(
        `update public.submission_tasks
         set status = 'submitted', execution_mode = 'live', confirmation_reference = 'GF-1001', completed_at = now()
         where id = $1`,
        [ok],
      );
      await sql.query("update public.submission_tasks set status = 'failed', completed_at = now() where id = $1", [
        failed,
      ]);
      await expectPgError(
        sql.query("update public.submission_tasks set status = 'pending' where id = $1", [ok]),
        CHECK_VIOLATION,
      );
      // Non-status bookkeeping on the finished task is still allowed.
      await sql.query("update public.submission_tasks set last_error = null where id = $1", [ok]);
    });

    it("copies job and portal onto executions and computes duration", async () => {
      const jobId = await insertJob();
      const taskId = await assignAndQueue(jobId, "northstar");
      const { rows } = await sql.query(
        `insert into public.automation_executions (task_id, attempt, mode, status, worker_id, started_at, completed_at)
         values ($1, 1, 'dry_run', 'succeeded', 'worker-1', now() - interval '42 seconds', now())
         returning job_id, portal_slug, organisation_id, duration_ms`,
        [taskId],
      );
      expect(rows[0]).toMatchObject({ job_id: jobId, portal_slug: "northstar", organisation_id: orgA });
      expect(Number(rows[0].duration_ms)).toBeGreaterThanOrEqual(41_000);
    });

    it("requires running executions to be open and finished ones to be closed", async () => {
      const taskId = await assignAndQueue(await insertJob(), "bluepeak");
      await expectPgError(
        sql.query(
          "insert into public.automation_executions (task_id, attempt, mode, status, completed_at) values ($1, 1, 'dry_run', 'running', now())",
          [taskId],
        ),
        CHECK_VIOLATION,
      );
    });

    it("keeps portal slugs immutable", async () => {
      await expectPgError(
        sql.query("update public.portals set slug = 'northstar2' where slug = 'northstar'"),
        CHECK_VIOLATION,
      );
    });
  });

  describe("auth profiles", () => {
    it("creates a viewer profile for every new auth user", async () => {
      const id = await createUser("new.person@example.com");
      const { rows } = await sql.query("select role, organisation_id, full_name from public.profiles where id = $1", [
        id,
      ]);
      expect(rows[0]).toMatchObject({ role: "viewer", organisation_id: orgA, full_name: "Test User" });
    });

    it("takes the organisation from app_metadata only, never user_metadata", async () => {
      const { rows } = await sql.query(
        `insert into auth.users (email, raw_user_meta_data) values ('sneaky@example.com', '{"organisation_slug":"other"}') returning id`,
      );
      const profile = await sql.query("select organisation_id from public.profiles where id = $1", [rows[0].id]);
      expect(profile.rows[0].organisation_id).toBe(orgA);
    });
  });

  describe("audit log", () => {
    it("is readable only by admins, and rolled-back changes leave no entry", async () => {
      const jobId = await insertJob();
      await db.as("authenticated", users.operator, async (c) => {
        await c.query("update public.jobs set archived_at = now(), archived_by = $2 where id = $1", [
          jobId,
          users.operator,
        ]);
        const { rows } = await c.query(
          "select action, actor_id, actor_type from public.audit_logs where entity_id = $1 order by id",
          [jobId],
        );
        // Operators cannot read the audit log (admin only) …
        expect(rows).toHaveLength(0);
      });
      // … but the entries exist, written by the trigger.
      const { rows } = await sql.query(
        "select action, actor_id, actor_type, changes from public.audit_logs where entity_id = $1 order by id",
        [jobId],
      );
      expect(rows.map((r) => r.action)).toEqual(["jobs.created"]);
    });

    it("captures the actor on a committed change", async () => {
      const jobId = await insertJob();
      await sql.query("begin");
      await sql.query("set local role authenticated");
      await sql.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: users.operator })]);
      await sql.query("update public.jobs set archived_at = now(), archived_by = $2 where id = $1", [
        jobId,
        users.operator,
      ]);
      await sql.query("commit");
      const { rows } = await sql.query(
        "select action, actor_id, actor_type, changes from public.audit_logs where entity_id = $1 order by id",
        [jobId],
      );
      expect(rows.map((r) => r.action)).toEqual(["jobs.created", "jobs.archived"]);
      expect(rows[1]).toMatchObject({ actor_id: users.operator, actor_type: "user" });
      expect(rows[1].changes).toHaveProperty("archived_at");
    });

    it("is append-only, even for the table owner", async () => {
      await expectPgError(sql.query("update public.audit_logs set action = 'tampered'"), INSUFFICIENT_PRIVILEGE);
      await expectPgError(sql.query("delete from public.audit_logs"), INSUFFICIENT_PRIVILEGE);
    });

    it("never copies integration secrets into the log", async () => {
      await sql.query(
        `insert into public.integration_settings (organisation_id, kind, secret_ciphertext, secret_hint)
         values ($1, 'n8n', 'ciphertext-should-not-leak', '••••leak')`,
        [orgA],
      );
      const { rows } = await sql.query(
        "select changes::text as c from public.audit_logs where entity_type = 'integration_settings'",
      );
      expect(rows.some((r) => r.c.includes("ciphertext-should-not-leak"))).toBe(false);
    });
  });

  describe("row level security", () => {
    it("gives anonymous callers no table access", async () => {
      await db.as("anon", null, async (c) => {
        await expectPgError(c.query("select id from public.jobs"), INSUFFICIENT_PRIVILEGE);
      });
    });

    it("limits users to their own organisation", async () => {
      const mine = await insertJob();
      const theirs = await insertJob({ organisation_id: orgB });
      await db.as("authenticated", users.viewer, async (c) => {
        const { rows } = await c.query("select id from public.jobs where id = any($1)", [[mine, theirs]]);
        expect(rows.map((r) => r.id)).toEqual([mine]);
      });
      await db.as("authenticated", users.outsider, async (c) => {
        const { rows } = await c.query("select id from public.jobs where id = any($1)", [[mine, theirs]]);
        expect(rows.map((r) => r.id)).toEqual([theirs]);
      });
    });

    it("lets operators create jobs but not viewers", async () => {
      await db.as("authenticated", users.operator, async (c) => {
        await expect(insertJob({}, c)).resolves.toBeTruthy();
      });
      await db.as("authenticated", users.viewer, async (c) => {
        await expectPgError(insertJob({}, c), INSUFFICIENT_PRIVILEGE);
      });
    });

    it("stops operators creating jobs in another organisation", async () => {
      await db.as("authenticated", users.operator, async (c) => {
        await expectPgError(insertJob({ organisation_id: orgB }, c), INSUFFICIENT_PRIVILEGE);
      });
    });

    it("lets viewers read but never write submission tasks", async () => {
      const taskId = await assignAndQueue(await insertJob(), "apex");
      await db.as("authenticated", users.viewer, async (c) => {
        const { rows } = await c.query("select id from public.submission_tasks where id = $1", [taskId]);
        expect(rows).toHaveLength(1);
        await expectPgError(
          c.query("update public.submission_tasks set status = 'cancelled' where id = $1", [taskId]),
          INSUFFICIENT_PRIVILEGE,
        );
      });
    });

    it("hides integration secret ciphertext even from admins", async () => {
      await db.as("authenticated", users.admin, async (c) => {
        const { rows } = await c.query("select kind, secret_hint from public.integration_settings");
        expect(rows.length).toBeGreaterThan(0);
        await expectPgError(
          c.query("select secret_ciphertext from public.integration_settings"),
          INSUFFICIENT_PRIVILEGE,
        );
      });
      await db.as("authenticated", users.operator, async (c) => {
        const { rows } = await c.query("select kind from public.integration_settings");
        expect(rows).toHaveLength(0);
      });
    });

    it("only lets admins change roles", async () => {
      await db.as("authenticated", users.operator, async (c) => {
        const r = await c.query("update public.profiles set role = 'admin' where id = $1", [users.operator]);
        expect(r.rowCount).toBe(0);
      });
      await db.as("authenticated", users.admin, async (c) => {
        const r = await c.query("update public.profiles set role = 'operator' where id = $1", [users.viewer]);
        expect(r.rowCount).toBe(1);
      });
    });

    it("blocks deactivated users entirely", async () => {
      const id = await createUser("leaver@example.com");
      await sql.query("update public.profiles set is_active = false where id = $1", [id]);
      await insertJob();
      await db.as("authenticated", id, async (c) => {
        const { rows } = await c.query("select id from public.jobs");
        expect(rows).toHaveLength(0);
      });
    });

    it("restricts storage objects to the user's organisation folder", async () => {
      await sql.query(
        "insert into storage.objects (bucket_id, name) values ('job-attachments', $1), ('job-attachments', $2)",
        [`${orgA}/job/photo.jpg`, `${orgB}/job/photo.jpg`],
      );
      await db.as("authenticated", users.viewer, async (c) => {
        const { rows } = await c.query("select name from storage.objects");
        expect(rows.map((r) => r.name)).toEqual([`${orgA}/job/photo.jpg`]);
      });
    });
  });
});
