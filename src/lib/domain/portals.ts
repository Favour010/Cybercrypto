/**
 * The five destination client portals.
 *
 * These are SIMULATED demonstration portals, not production customer systems.
 * Saving a URL here never implies a portal is "connected" — connection state is
 * only ever derived from a real, recorded connection test (Phase 4).
 */
export const PORTAL_SLUGS = ["northstar", "bluepeak", "greenfield", "apex", "metrocare"] as const;

export type PortalSlug = (typeof PORTAL_SLUGS)[number];

export interface PortalDefinition {
  slug: PortalSlug;
  name: string;
  demoUrl: string;
  /** All five portals are demo/simulated environments in this project. */
  environment: "demo";
}

const DEMO_BASE = "https://jobsync-portal-tracker.lovable.app/portal";

export const PORTALS: readonly PortalDefinition[] = [
  { slug: "northstar", name: "Northstar", demoUrl: `${DEMO_BASE}/northstar`, environment: "demo" },
  { slug: "bluepeak", name: "BluePeak", demoUrl: `${DEMO_BASE}/bluepeak`, environment: "demo" },
  { slug: "greenfield", name: "Greenfield", demoUrl: `${DEMO_BASE}/greenfield`, environment: "demo" },
  { slug: "apex", name: "Apex", demoUrl: `${DEMO_BASE}/apex`, environment: "demo" },
  { slug: "metrocare", name: "MetroCare", demoUrl: `${DEMO_BASE}/metrocare`, environment: "demo" },
];

export function isPortalSlug(value: unknown): value is PortalSlug {
  return typeof value === "string" && (PORTAL_SLUGS as readonly string[]).includes(value);
}

export function getPortal(slug: PortalSlug): PortalDefinition {
  const portal = PORTALS.find((p) => p.slug === slug);
  if (!portal) throw new Error(`Unknown portal: ${slug}`);
  return portal;
}
