/**
 * Destination routing. Pure and shared by the demo engine and (later) the
 * Supabase backend. A rule matches when ALL of its set conditions match.
 * Every decision carries a human-readable reason. There is no "send to all
 * portals" fallback: no match means the job needs human review.
 */
import type { PortalSlug } from "@/lib/domain/portals";
import type { JobPriority } from "@/lib/domain/status";

export interface RoutableJob {
  customer_name: string;
  category: string;
  priority: JobPriority;
  service_address: string;
}

export interface RuleLike {
  id: string;
  name: string;
  priority: number;
  is_active: boolean;
  match_customer: string | null;
  match_category: string | null;
  match_priority: JobPriority | null;
  match_location: string | null;
  portal_slug: PortalSlug;
}

const norm = (s: string) => s.trim().toLowerCase();

/** Which conditions of `rule` match `job` (null if any set condition fails). */
export function explainMatch(job: RoutableJob, rule: RuleLike): string[] | null {
  const reasons: string[] = [];
  if (rule.match_customer) {
    if (!norm(job.customer_name).includes(norm(rule.match_customer))) return null;
    reasons.push(`customer contains "${rule.match_customer}"`);
  }
  if (rule.match_category) {
    if (norm(job.category) !== norm(rule.match_category)) return null;
    reasons.push(`category is "${rule.match_category}"`);
  }
  if (rule.match_priority) {
    if (job.priority !== rule.match_priority) return null;
    reasons.push(`priority is ${rule.match_priority}`);
  }
  if (rule.match_location) {
    if (!norm(job.service_address).includes(norm(rule.match_location))) return null;
    reasons.push(`address contains "${rule.match_location}"`);
  }
  return reasons.length > 0 ? reasons : null;
}

export interface RoutingDecision {
  portal_slug: PortalSlug;
  rule_id: string;
  reason: string;
}

/**
 * Evaluate active rules in priority order (lower number first). Each portal is
 * assigned at most once, by the first rule that targets it.
 */
export function routeJob(job: RoutableJob, rules: RuleLike[]): RoutingDecision[] {
  const decisions: RoutingDecision[] = [];
  const active = rules
    .filter((r) => r.is_active)
    .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
  for (const rule of active) {
    if (decisions.some((d) => d.portal_slug === rule.portal_slug)) continue;
    const why = explainMatch(job, rule);
    if (why)
      decisions.push({
        portal_slug: rule.portal_slug,
        rule_id: rule.id,
        reason: `Rule "${rule.name}": ${why.join(", ")}`,
      });
  }
  return decisions;
}

export const NO_ROUTE_REASON = "No active routing rule matched this job. Assign destination portals manually.";
