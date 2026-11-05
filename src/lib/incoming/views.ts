/** Incoming Jobs views (shared by the server page and the demo data layer). */
export const INCOMING_VIEWS = ["new", "accepted", "duplicate", "rejected", "failed", "awaiting_routing"] as const;
export type IncomingView = (typeof INCOMING_VIEWS)[number];

export const INCOMING_VIEW_META: Record<IncomingView, { label: string; description: string; kind: "jobs" | "events" }> =
  {
    new: { label: "Newly received", description: "Jobs received in the last 24 hours, from any source.", kind: "jobs" },
    accepted: {
      label: "Validated",
      description: "Intake requests that passed validation and created a job.",
      kind: "events",
    },
    duplicate: {
      label: "Duplicates",
      description: "Repeat imports of an external job already received. Nothing was changed.",
      kind: "events",
    },
    rejected: {
      label: "Rejected",
      description: "Requests refused for authentication, validation or source rules.",
      kind: "events",
    },
    failed: {
      label: "Import errors",
      description: "Requests that could not be stored because of a server error.",
      kind: "events",
    },
    awaiting_routing: {
      label: "Awaiting routing",
      description: "Jobs with no destination portal yet. Routing rules arrive in Phase 4.",
      kind: "jobs",
    },
  };

export function parseIncomingView(v: unknown): IncomingView {
  return typeof v === "string" && (INCOMING_VIEWS as readonly string[]).includes(v) ? (v as IncomingView) : "new";
}
