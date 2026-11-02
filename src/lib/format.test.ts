import { describe, expect, it } from "vitest";

import { formatDuration, formatNumber, formatPercent } from "@/lib/format";

describe("format", () => {
  it("renders missing values as an em dash, never as zero", () => {
    expect(formatNumber(null)).toBe("—");
    expect(formatPercent(null)).toBe("—");
    expect(formatDuration(null)).toBe("—");
  });

  it("formats durations", () => {
    expect(formatDuration(850)).toBe("850ms");
    expect(formatDuration(42_000)).toBe("42s");
    expect(formatDuration(185_000)).toBe("3m 05s");
    expect(formatDuration(4_320_000)).toBe("1h 12m");
  });

  it("formats percentages", () => {
    expect(formatPercent(0.9234)).toBe("92.3%");
  });
});
