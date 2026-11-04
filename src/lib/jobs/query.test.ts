import { describe, expect, it } from "vitest";

import { DEFAULT_PAGE_SIZE, hasActiveFilters, jobsHref, parseJobsQuery, toLikePattern } from "@/lib/jobs/query";

describe("parseJobsQuery", () => {
  it("applies defaults", () => {
    expect(parseJobsQuery({})).toEqual({
      q: "",
      status: undefined,
      source: undefined,
      priority: undefined,
      portal: undefined,
      archived: "active",
      sort: "received_at",
      dir: "desc",
      page: 1,
      size: DEFAULT_PAGE_SIZE,
    });
  });

  it("accepts valid filters", () => {
    const q = parseJobsQuery({
      q: "  example   facilities ",
      status: "failed",
      source: "external",
      priority: "urgent",
      portal: "apex",
      archived: "all",
      sort: "customer_name",
      dir: "asc",
      page: "3",
      size: "50",
    });
    expect(q).toMatchObject({
      q: "example facilities",
      status: "failed",
      portal: "apex",
      archived: "all",
      sort: "customer_name",
      dir: "asc",
      page: 3,
      size: 50,
    });
  });

  it("ignores unknown or hostile values instead of passing them to the database", () => {
    const q = parseJobsQuery({
      status: "drop table",
      portal: "everything",
      sort: "raw_payload",
      dir: "sideways",
      page: "-4",
      size: "100000",
      archived: "yes",
    });
    expect(q).toMatchObject({
      status: undefined,
      portal: undefined,
      sort: "received_at",
      dir: "desc",
      page: 1,
      size: DEFAULT_PAGE_SIZE,
      archived: "active",
    });
  });

  it("takes the first value of repeated params and caps search length", () => {
    expect(parseJobsQuery({ status: ["failed", "submitted"] }).status).toBe("failed");
    expect(parseJobsQuery({ q: "x".repeat(500) }).q).toHaveLength(100);
  });
});

describe("toLikePattern", () => {
  it("matches user input literally", () => {
    expect(toLikePattern("50% off_now\\")).toBe("%50\\% off\\_now\\\\%");
    expect(toLikePattern("ARO-2026")).toBe("%aro-2026%");
  });
});

describe("jobsHref", () => {
  it("omits defaults and keeps filters", () => {
    const base = parseJobsQuery({});
    expect(jobsHref(base)).toBe("/jobs");
    expect(jobsHref(base, { status: "failed", page: 2 })).toBe("/jobs?status=failed&page=2");
    expect(hasActiveFilters(base)).toBe(false);
    expect(hasActiveFilters(parseJobsQuery({ archived: "archived" }))).toBe(true);
  });
});
