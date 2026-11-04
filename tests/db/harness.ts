/**
 * Test harness: creates a throwaway PostgreSQL database, applies the Supabase
 * shim and every migration in order, and offers helpers to run SQL as a given
 * Supabase role/user. Requires JOBSYNC_TEST_DATABASE_URL (a superuser URL to
 * any database on the server, e.g. postgres://postgres@127.0.0.1:54329/postgres).
 */
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { Client } from "pg";

export const TEST_DATABASE_URL = process.env.JOBSYNC_TEST_DATABASE_URL;

const ROOT = path.resolve(__dirname, "../..");
const MIGRATIONS_DIR = path.join(ROOT, "supabase/migrations");
const SHIM = path.join(ROOT, "supabase/tests/supabase-shim.sql");

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{14}_[a-z0-9_]+\.sql$/.test(f))
    .sort();
}

export interface TestDb {
  client: Client;
  name: string;
  /** Run `fn` inside a transaction as `role` with JWT claims for `userId`; always rolled back. */
  as<T>(
    role: "anon" | "authenticated" | "service_role",
    userId: string | null,
    fn: (c: Client) => Promise<T>,
  ): Promise<T>;
  drop(): Promise<void>;
}

export async function createTestDb(): Promise<TestDb> {
  if (!TEST_DATABASE_URL) throw new Error("JOBSYNC_TEST_DATABASE_URL is not set");
  const name = `jobsync_test_${randomBytes(6).toString("hex")}`;

  const admin = new Client({ connectionString: TEST_DATABASE_URL });
  await admin.connect();
  await admin.query(`create database ${name}`);
  await admin.end();

  const url = new URL(TEST_DATABASE_URL);
  url.pathname = `/${name}`;
  const client = new Client({ connectionString: url.toString() });
  await client.connect();

  await client.query(readFileSync(SHIM, "utf8"));
  for (const file of migrationFiles()) {
    try {
      await client.query(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
    } catch (err) {
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    }
  }

  return {
    client,
    name,
    async as(role, userId, fn) {
      await client.query("begin");
      try {
        await client.query(`set local role ${role}`);
        await client.query("select set_config('request.jwt.claims', $1, true)", [
          JSON.stringify(userId ? { sub: userId, role } : { role }),
        ]);
        return await fn(client);
      } finally {
        await client.query("rollback");
      }
    },
    async drop() {
      await client.end();
      const a = new Client({ connectionString: TEST_DATABASE_URL });
      await a.connect();
      await a.query(`drop database if exists ${name} with (force)`);
      await a.end();
    },
  };
}

/** Assert that `promise` rejects with the given Postgres SQLSTATE code. */
export async function expectPgError(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
  } catch (err) {
    const actual = (err as { code?: string }).code;
    if (actual !== code) throw new Error(`Expected SQLSTATE ${code}, got ${actual}: ${(err as Error).message}`);
    return;
  }
  throw new Error(`Expected SQLSTATE ${code}, but the statement succeeded`);
}
