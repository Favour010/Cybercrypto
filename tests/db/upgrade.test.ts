import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDb, expectPgError, TEST_DATABASE_URL, type TestDb } from "./harness";

/**
 * Upgrade test for migration 0009: data written under the old global
 * uniqueness rule must survive unchanged, and duplicate protection must stay
 * in force within each organisation.
 */
describe.skipIf(!TEST_DATABASE_URL)("migration 0009: organisation-scoped external job uniqueness", () => {
  let db: TestDb;
  let orgA = "";
  let orgB = "";
  let before: { id: string; reference: string; external_job_id: string | null }[] = [];

  const insert = (org: string, externalId: string | null, sourceType = "external", source = "aroflo") =>
    db.client.query(
      `insert into public.jobs (organisation_id, source_type, source, external_job_id, customer_name, service_address, category, description)
       values ($1, $2, $3, $4, 'Customer', 'Address', 'Category', 'Description')`,
      [org, sourceType, source, externalId],
    );

  beforeAll(async () => {
    db = await createTestDb({ stopBefore: "20261105000900" });
    await db.client.query("insert into public.organisations (name, slug) values ('Second org', 'second')");
    orgA = (await db.client.query("select id from public.organisations where slug = 'default'")).rows[0].id;
    orgB = (await db.client.query("select id from public.organisations where slug = 'second'")).rows[0].id;

    // Existing data under the old rule.
    await insert(orgA, "ARO-1");
    await insert(orgA, "ARO-2");
    await insert(orgB, "ARO-3");
    await insert(orgA, null, "manual", "manual");
    // Old rule: the same ID in another organisation was (wrongly) a duplicate.
    await expectPgError(insert(orgB, "ARO-1"), "23505");

    before = (await db.client.query("select id, reference, external_job_id from public.jobs order by id")).rows;
    await db.applyRemaining();
  }, 120_000);

  afterAll(async () => {
    await db?.drop();
  });

  it("preserves every existing row unchanged", async () => {
    const after = (await db.client.query("select id, reference, external_job_id from public.jobs order by id")).rows;
    expect(after).toEqual(before);
    expect(after).toHaveLength(4);
  });

  it("replaces the old constraint with the organisation-scoped one", async () => {
    const { rows } = await db.client.query(
      `select conname, pg_get_constraintdef(oid) as def from pg_constraint
       where conrelid = 'public.jobs'::regclass and contype = 'u' order by conname`,
    );
    const names = rows.map((r) => r.conname);
    expect(names).toContain("jobs_org_source_external_job_id_key");
    expect(names).not.toContain("jobs_source_external_job_id_key");
    expect(rows.find((r) => r.conname === "jobs_org_source_external_job_id_key")?.def).toBe(
      "UNIQUE (organisation_id, source, external_job_id)",
    );
  });

  it("now accepts the same external ID in a different organisation", async () => {
    await expect(insert(orgB, "ARO-1")).resolves.toBeTruthy();
  });

  it("still rejects duplicates within one organisation", async () => {
    await expectPgError(insert(orgA, "ARO-2"), "23505");
    await expectPgError(insert(orgB, "ARO-3"), "23505");
  });
});
