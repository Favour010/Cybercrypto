import { describe, expect, it } from "vitest";

import { APP_ROLES, PERMISSIONS, can, hasMinRole, isAppRole } from "@/lib/auth/permissions";

describe("permissions", () => {
  it("orders roles viewer < operator < admin", () => {
    expect(hasMinRole("viewer", "operator")).toBe(false);
    expect(hasMinRole("operator", "operator")).toBe(true);
    expect(hasMinRole("admin", "operator")).toBe(true);
    expect(hasMinRole(null, "viewer")).toBe(false);
  });

  it("lets viewers read but not change jobs", () => {
    expect(can("viewer", "jobs.read")).toBe(true);
    expect(can("viewer", "jobs.create")).toBe(false);
    expect(can("viewer", "jobs.archive")).toBe(false);
  });

  it("lets operators manage jobs but not configuration", () => {
    expect(can("operator", "jobs.archive")).toBe(true);
    expect(can("operator", "portals.manage")).toBe(false);
    expect(can("operator", "integrations.manage")).toBe(false);
    expect(can("operator", "audit_logs.read")).toBe(false);
  });

  it("gives admins every permission", () => {
    for (const p of Object.keys(PERMISSIONS) as (keyof typeof PERMISSIONS)[]) expect(can("admin", p)).toBe(true);
  });

  it("matches the database role enum order", () => {
    expect(APP_ROLES).toEqual(["viewer", "operator", "admin"]);
    expect(isAppRole("owner")).toBe(false);
  });
});
