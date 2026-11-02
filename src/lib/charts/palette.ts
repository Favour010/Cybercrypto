/**
 * Chart colour roles. Values live in globals.css so light/dark switch in one
 * place; charts reference roles, never raw hex.
 *
 * - Categorical slots are assigned in fixed order (never cycled) and were
 *   checked with a CVD/contrast validator for adjacent pairs.
 * - Status colours are reserved for state and always ship with a label.
 */
export const SERIES = {
  1: "var(--series-1)",
  2: "var(--series-2)",
  3: "var(--series-3)",
} as const;

export const STATUS_COLOR = {
  good: "var(--status-good)",
  warning: "var(--status-warning)",
  serious: "var(--status-serious)",
  critical: "var(--status-critical)",
} as const;

export const CHART_CHROME = {
  surface: "var(--chart-surface)",
  grid: "var(--chart-grid)",
  axis: "var(--chart-axis)",
} as const;
