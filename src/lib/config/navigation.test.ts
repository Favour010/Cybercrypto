import { describe, expect, it } from "vitest";

import { NAV_ITEMS, findActiveNavItem } from "@/lib/config/navigation";

describe("navigation", () => {
  it("has the twelve required modules with unique routes", () => {
    expect(NAV_ITEMS).toHaveLength(12);
    expect(new Set(NAV_ITEMS.map((i) => i.href)).size).toBe(12);
  });

  it("uses the most specific match", () => {
    expect(findActiveNavItem("/")?.title).toBe("Overview");
    expect(findActiveNavItem("/jobs")?.title).toBe("Jobs");
    expect(findActiveNavItem("/jobs/123")?.title).toBe("Jobs");
    expect(findActiveNavItem("/jobs/new")?.title).toBe("Create Job");
    expect(findActiveNavItem("/settings/system")?.title).toBe("System Configuration");
  });
});
