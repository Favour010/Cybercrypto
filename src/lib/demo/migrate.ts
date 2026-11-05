/**
 * Upgrades demo state saved by an older version of the app, so a browser keeps
 * its demo data across releases. Unknown or newer versions return null and the
 * caller falls back to a fresh seed.
 */
import { DEMO_STATE_VERSION, type DemoState } from "./types";

type Loose = Record<string, unknown> & { version?: unknown };

export function migrateState(raw: unknown): DemoState | null {
  if (!raw || typeof raw !== "object") return null;
  let s = raw as Loose;
  if (s.version === 1) {
    // v2: users gained is_active and created_at.
    const seededAt = typeof s.seeded_at === "string" ? s.seeded_at : new Date(0).toISOString();
    const users = Array.isArray(s.users) ? s.users : [];
    s = {
      ...s,
      version: 2,
      users: users.map((u: Record<string, unknown>) => ({ is_active: true, created_at: seededAt, ...u })),
    };
  }
  return s.version === DEMO_STATE_VERSION ? (s as unknown as DemoState) : null;
}
