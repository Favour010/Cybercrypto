import { describe, expect, it } from "vitest";

import { getAuthConfig, isDevAuthBypassActive, missingAuthConfig } from "@/lib/auth/config";
import { classifyRoute, safeNextPath } from "@/lib/auth/routes";

describe("classifyRoute", () => {
  it("protects every application page", () => {
    for (const p of ["/", "/jobs", "/jobs/abc", "/portals", "/settings/system", "/account/password"]) {
      expect(classifyRoute(p)).toBe("protected_page");
    }
  });

  it("protects API routes by default", () => {
    expect(classifyRoute("/api/jobs")).toBe("protected_api");
    expect(classifyRoute("/api")).toBe("protected_api");
  });

  it("leaves only sign-in pages and health public", () => {
    expect(classifyRoute("/login")).toBe("public_page");
    expect(classifyRoute("/setup")).toBe("public_page");
    expect(classifyRoute("/auth/confirm")).toBe("public_page");
    expect(classifyRoute("/api/health")).toBe("public_api");
    expect(classifyRoute("/loginx")).toBe("protected_page");
    expect(classifyRoute("/api/healthz")).toBe("protected_api");
  });

  it("routes machine APIs to their own authentication", () => {
    expect(classifyRoute("/api/v1/jobs/intake")).toBe("machine_api");
  });
});

describe("safeNextPath", () => {
  it("keeps same-origin paths with their query", () => {
    expect(safeNextPath("/jobs?status=failed")).toBe("/jobs?status=failed");
  });

  it("blocks open redirects", () => {
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "jobs"]) {
      expect(safeNextPath(bad)).toBe("/");
    }
  });

  it("never redirects back to an auth page", () => {
    expect(safeNextPath("/login")).toBe("/");
    expect(safeNextPath(undefined, "/jobs")).toBe("/jobs");
  });
});

describe("auth config", () => {
  const configured = { NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon" };

  it("reports missing variable names", () => {
    expect(getAuthConfig({ NODE_ENV: "test" })).toBeNull();
    expect(missingAuthConfig({ NODE_ENV: "test", NEXT_PUBLIC_SUPABASE_URL: "https://x" })).toEqual([
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    ]);
  });

  it("allows the dev bypass only in development, when requested, without Supabase", () => {
    expect(isDevAuthBypassActive({ NODE_ENV: "development", JOBSYNC_DEV_AUTH_BYPASS: "true" })).toBe(true);
    expect(isDevAuthBypassActive({ NODE_ENV: "production", JOBSYNC_DEV_AUTH_BYPASS: "true" })).toBe(false);
    expect(isDevAuthBypassActive({ NODE_ENV: "test", JOBSYNC_DEV_AUTH_BYPASS: "true" })).toBe(false);
    expect(isDevAuthBypassActive({ NODE_ENV: "development", JOBSYNC_DEV_AUTH_BYPASS: "1" })).toBe(false);
    expect(isDevAuthBypassActive({ NODE_ENV: "development", JOBSYNC_DEV_AUTH_BYPASS: "true", ...configured })).toBe(
      false,
    );
  });
});
