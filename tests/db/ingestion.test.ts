/**
 * create_manual_job() and update_job() as signed-in users (real PostgreSQL,
 * Row Level Security in force).
 */
import { randomUUID } from "node:crypto";

import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDb, expectPgError, TEST_DATABASE_URL, type TestDb } from "./harness";

const FIELDS = {
  customer_name: "Harbour View Apartments",
  service_address: "12 Quay Road",
  category: "Plumbing",
  priority: "urgent",
  description: "Burst pipe in plant room.",
  instructions: "Isolate supply first.",
  scheduled_date: "2026-11-06",
  scheduled_time: "08:30:00",
  technician: "Technician B",
};

describe.skipIf(!TEST_DATABASE_URL)("manual job creation and editing (real PostgreSQL)", () => {
  let db: TestDb;
  let sql: Client;
  let orgA = "";
  const users = { operator: "", viewer: "", outsider: "" };

  async function user(email: string, role: string, orgSlug?: string) {
    const { rows } = await sql.query("insert into auth.users (email, raw_app_meta_data) values ($1, $2) returning id", [
      email,
      orgSlug ? { organisation_slug: orgSlug } : {},
    ]);
    await sql.query("update public.profiles set role = $2 where id = $1", [rows[0].id, role]);
    return rows[0].id as string;
  }

  /** Create a job as `who` and COMMIT it (so later calls can see it). */
  async function createAs(
    who: string,
    opts: { destinations?: string[]; attachments?: unknown[]; token?: string; jobId?: string } = {},
  ) {
    const jobId = opts.jobId ?? randomUUID();
    const c = await db.connect();
    try {
      await c.query("begin");
      await c.query("set local role authenticated");
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: who })]);
      const { rows } = await c.query("select public.create_manual_job($1, $2, $3, $4, $5, $6) as r", [
        FIELDS,
        { name: "Site Manager", email: "manager@example.com", phone: null },
        opts.destinations ?? ["northstar"],
        JSON.stringify(opts.attachments ?? []),
        opts.token ?? randomUUID(),
        jobId,
      ]);
      await c.query("commit");
      return rows[0].r as { created: boolean; job_id: string; status: string; reference: string };
    } catch (err) {
      await c.query("rollback");
      throw err;
    } finally {
      await c.end();
    }
  }

  async function updatedAt(jobId: string): Promise<string> {
    return (
      await sql.query("select updated_at from public.jobs where id = $1", [jobId])
    ).rows[0].updated_at.toISOString();
  }

  /** Call update_job as `who` and COMMIT on success. */
  async function updateAs(
    who: string,
    jobId: string,
    args: Partial<{
      expected: string;
      fields: Record<string, unknown>;
      contact: unknown;
      add: string[];
      remove: string[];
      addAttachments: unknown[];
      removeAttachments: string[];
      ack: boolean;
    }> = {},
  ) {
    const c = await db.connect();
    try {
      await c.query("begin");
      await c.query("set local role authenticated");
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: who })]);
      const { rows } = await c.query("select public.update_job($1, $2, $3, $4, $5, $6, $7, $8, $9) as r", [
        jobId,
        args.expected ?? (await updatedAt(jobId)),
        args.fields ?? {},
        args.contact === undefined ? null : JSON.stringify(args.contact),
        args.add ?? [],
        args.remove ?? [],
        JSON.stringify(args.addAttachments ?? []),
        args.removeAttachments ?? [],
        args.ack ?? false,
      ]);
      await c.query("commit");
      return rows[0].r as { status: string; removed_storage_paths: string[]; already_submitted_portals: number };
    } catch (err) {
      await c.query("rollback");
      throw err;
    } finally {
      await c.end();
    }
  }

  const tasks = async (jobId: string) =>
    (
      await sql.query(
        "select portal_slug, status, attempt_count from public.submission_tasks where job_id = $1 order by portal_slug",
        [jobId],
      )
    ).rows;

  beforeAll(async () => {
    db = await createTestDb();
    sql = db.client;
    await sql.query("insert into public.organisations (name, slug) values ('Other org', 'other')");
    orgA = (await sql.query("select id from public.organisations where slug = 'default'")).rows[0].id;
    users.operator = await user("op@example.com", "operator");
    users.viewer = await user("viewer@example.com", "viewer");
    users.outsider = await user("outsider@example.com", "operator", "other");
  }, 120_000);

  afterAll(async () => {
    await db?.drop();
  });

  describe("create_manual_job", () => {
    it("creates a manual job in the caller's organisation with pending tasks", async () => {
      const r = await createAs(users.operator, { destinations: ["northstar", "apex"] });
      expect(r).toMatchObject({ created: true, status: "ready" });
      const { rows } = await sql.query(
        "select organisation_id, source_type, source, external_job_id, created_by, status from public.jobs where id = $1",
        [r.job_id],
      );
      expect(rows[0]).toEqual({
        organisation_id: orgA,
        source_type: "manual",
        source: "manual",
        external_job_id: null,
        created_by: users.operator,
        status: "ready",
      });
      expect(await tasks(r.job_id)).toEqual([
        { portal_slug: "apex", status: "pending", attempt_count: 0 },
        { portal_slug: "northstar", status: "pending", attempt_count: 0 },
      ]);
      const a = await sql.query("select source, reason from public.job_portal_assignments where job_id = $1", [
        r.job_id,
      ]);
      expect(a.rows.every((x) => x.source === "explicit" && x.reason === "Selected on the Create Job form")).toBe(true);
    });

    it("is idempotent per form submission (double-click safe)", async () => {
      const token = randomUUID();
      const first = await createAs(users.operator, { token });
      const second = await createAs(users.operator, { token });
      expect(second).toMatchObject({ created: false, job_id: first.job_id });
    });

    it("keeps a job without destinations awaiting routing", async () => {
      const r = await createAs(users.operator, { destinations: [] });
      expect(r.status).toBe("received");
      expect(await tasks(r.job_id)).toEqual([]);
    });

    it("refuses viewers", async () => {
      await expectPgError(createAs(users.viewer), "JSU05");
    });

    it("only accepts attachments stored in the caller's organisation folder for this job", async () => {
      const jobId = randomUUID();
      const ok = {
        file_name: "photo.jpg",
        content_type: "image/jpeg",
        size_bytes: 10,
        storage_bucket: "job-attachments",
        storage_path: `${orgA}/${jobId}/a1-photo.jpg`,
      };
      const r = await createAs(users.operator, { jobId, attachments: [ok] });
      const { rows } = await sql.query(
        "select storage_path, uploaded_by from public.job_attachments where job_id = $1",
        [r.job_id],
      );
      expect(rows).toEqual([{ storage_path: ok.storage_path, uploaded_by: users.operator }]);

      const other = randomUUID();
      await expectPgError(
        createAs(users.operator, {
          jobId: other,
          attachments: [{ ...ok, storage_path: `${randomUUID()}/${other}/x.jpg` }],
        }),
        "JSU09",
      );
      await expectPgError(
        createAs(users.operator, {
          jobId: randomUUID(),
          attachments: [{ ...ok, storage_path: `${orgA}/${randomUUID()}/x.jpg` }],
        }),
        "JSU09",
      );
    });

    it("rejects unknown destinations without creating anything", async () => {
      const jobId = randomUUID();
      await expectPgError(createAs(users.operator, { jobId, destinations: ["nowhere"] }), "JSU01");
      const { rows } = await sql.query("select count(*)::int as n from public.jobs where id = $1", [jobId]);
      expect(rows[0].n).toBe(0);
    });
  });

  describe("update_job", () => {
    it("updates fields and the primary contact", async () => {
      const r = await createAs(users.operator);
      await updateAs(users.operator, r.job_id, {
        fields: { ...FIELDS, customer_name: "Harbour View Strata", priority: "high", instructions: "" },
        contact: { name: "New Manager", email: "new@example.com", phone: "+44 20 7946 0000" },
      });
      const { rows } = await sql.query(
        `select customer_name, priority, instructions,
           (select row_to_json(c) from (select name, email, phone from public.job_contacts where job_id = j.id and is_primary) c) as contact
         from public.jobs j where id = $1`,
        [r.job_id],
      );
      expect(rows[0]).toEqual({
        customer_name: "Harbour View Strata",
        priority: "high",
        instructions: null,
        contact: { name: "New Manager", email: "new@example.com", phone: "+44 20 7946 0000" },
      });
    });

    it("rejects a stale edit (optimistic concurrency)", async () => {
      const r = await createAs(users.operator);
      const stale = await updatedAt(r.job_id);
      await updateAs(users.operator, r.job_id, { fields: { technician: "First editor" } });
      await expectPgError(
        updateAs(users.operator, r.job_id, { expected: stale, fields: { technician: "Second" } }),
        "JSU03",
      );
    });

    it("adds destinations with exactly one new task each and never duplicates", async () => {
      const r = await createAs(users.operator, { destinations: ["northstar"] });
      await updateAs(users.operator, r.job_id, { add: ["bluepeak", "northstar"] });
      expect((await tasks(r.job_id)).map((t) => t.portal_slug)).toEqual(["bluepeak", "northstar"]);
      const a = await sql.query(
        "select source from public.job_portal_assignments a join public.portals p on p.id = a.portal_id where job_id = $1 and p.slug = 'bluepeak'",
        [r.job_id],
      );
      expect(a.rows[0].source).toBe("manual_override");
    });

    it("removes a never-attempted destination and falls back to awaiting routing", async () => {
      const r = await createAs(users.operator, { destinations: ["apex"] });
      const out = await updateAs(users.operator, r.job_id, { remove: ["apex"] });
      expect(out.status).toBe("received");
      expect(await tasks(r.job_id)).toEqual([]);
    });

    it("refuses to remove a destination that was already attempted", async () => {
      const r = await createAs(users.operator, { destinations: ["apex"] });
      await sql.query(
        "update public.submission_tasks set status = 'retry_scheduled', attempt_count = 1 where job_id = $1",
        [r.job_id],
      );
      await expectPgError(updateAs(users.operator, r.job_id, { remove: ["apex"] }), "JSU04");
    });

    it("blocks edits while a submission is processing", async () => {
      const r = await createAs(users.operator, { destinations: ["apex"] });
      await sql.query("update public.submission_tasks set status = 'processing', attempt_count = 1 where job_id = $1", [
        r.job_id,
      ]);
      await expectPgError(updateAs(users.operator, r.job_id, { fields: { technician: "X" } }), "JSU04");
    });

    it("requires acknowledgement after a portal received the job, and never re-queues it", async () => {
      const r = await createAs(users.operator, { destinations: ["northstar", "bluepeak"] });
      await sql.query(
        `update public.submission_tasks
         set status = 'submitted', execution_mode = 'live', confirmation_reference = 'NS-42', attempt_count = 1, completed_at = now()
         where job_id = $1 and portal_slug = 'northstar'`,
        [r.job_id],
      );
      await expectPgError(updateAs(users.operator, r.job_id, { fields: { description: "Updated scope" } }), "JSU07");
      const out = await updateAs(users.operator, r.job_id, { fields: { description: "Updated scope" }, ack: true });
      expect(out.already_submitted_portals).toBe(1);
      expect(await tasks(r.job_id)).toEqual([
        { portal_slug: "bluepeak", status: "pending", attempt_count: 0 },
        { portal_slug: "northstar", status: "submitted", attempt_count: 1 },
      ]);
    });

    it("allows non-content changes (e.g. adding a destination) after submission without acknowledgement", async () => {
      const r = await createAs(users.operator, { destinations: ["northstar"] });
      await sql.query(
        `update public.submission_tasks set status = 'submitted', confirmation_reference = 'DRY', attempt_count = 1, completed_at = now() where job_id = $1`,
        [r.job_id],
      );
      await updateAs(users.operator, r.job_id, { add: ["greenfield"] });
      expect((await tasks(r.job_id)).map((t) => `${t.portal_slug}:${t.status}`)).toEqual([
        "greenfield:pending",
        "northstar:submitted",
      ]);
    });

    it("adds and removes attachments, returning storage paths to clean up", async () => {
      const r = await createAs(users.operator);
      const path = `${orgA}/${r.job_id}/b2-report.pdf`;
      await updateAs(users.operator, r.job_id, {
        addAttachments: [
          {
            file_name: "report.pdf",
            content_type: "application/pdf",
            size_bytes: 99,
            storage_bucket: "job-attachments",
            storage_path: path,
          },
        ],
      });
      const id = (await sql.query("select id from public.job_attachments where job_id = $1", [r.job_id])).rows[0].id;
      const out = await updateAs(users.operator, r.job_id, { removeAttachments: [id] });
      expect(out.removed_storage_paths).toEqual([path]);
    });

    it("refuses viewers, other organisations and archived jobs", async () => {
      const r = await createAs(users.operator);
      await expectPgError(updateAs(users.viewer, r.job_id, { fields: { technician: "X" } }), "JSU05");
      await expectPgError(updateAs(users.outsider, r.job_id, { fields: { technician: "X" } }), "JSU06");
      await sql.query("update public.jobs set archived_at = now() where id = $1", [r.job_id]);
      await expectPgError(updateAs(users.operator, r.job_id, { fields: { technician: "X" } }), "JSU08");
    });

    it("cannot change provenance through the edit function", async () => {
      const r = await createAs(users.operator);
      await updateAs(users.operator, r.job_id, {
        fields: { source: "aroflo", external_job_id: "SPOOF", source_type: "external" },
      });
      const { rows } = await sql.query("select source, source_type, external_job_id from public.jobs where id = $1", [
        r.job_id,
      ]);
      expect(rows[0]).toEqual({ source: "manual", source_type: "manual", external_job_id: null });
    });

    it("records edits in the audit log with the editor", async () => {
      const r = await createAs(users.operator);
      await updateAs(users.operator, r.job_id, { fields: { technician: "Audited" } });
      const { rows } = await sql.query(
        "select action, actor_id from public.audit_logs where entity_id = $1 and action = 'jobs.updated'",
        [r.job_id],
      );
      expect(rows.some((x) => x.actor_id === users.operator)).toBe(true);
    });
  });
});
