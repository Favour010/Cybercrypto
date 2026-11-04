/**
 * Role-based access control. Mirrors the Row Level Security policies in
 * supabase/migrations/20261104000600_row_level_security.sql: the UI and server
 * actions check permissions for clear feedback, and the database enforces the
 * same rules independently.
 */
export const APP_ROLES = ["viewer", "operator", "admin"] as const;
export type AppRole = (typeof APP_ROLES)[number];

const RANK: Record<AppRole, number> = { viewer: 0, operator: 1, admin: 2 };

export function isAppRole(value: unknown): value is AppRole {
  return typeof value === "string" && (APP_ROLES as readonly string[]).includes(value);
}

export function hasMinRole(role: AppRole | null | undefined, required: AppRole): boolean {
  return role ? RANK[role] >= RANK[required] : false;
}

export const PERMISSIONS = {
  "jobs.read": "viewer",
  "jobs.create": "operator",
  "jobs.edit": "operator",
  "jobs.archive": "operator",
  "queue.read": "viewer",
  "queue.retry": "operator",
  "integration_events.read": "operator",
  "portals.manage": "admin",
  "routing_rules.manage": "admin",
  "integrations.manage": "admin",
  "users.manage": "admin",
  "audit_logs.read": "admin",
  "system.configure": "admin",
} as const satisfies Record<string, AppRole>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: AppRole | null | undefined, permission: Permission): boolean {
  return hasMinRole(role, PERMISSIONS[permission]);
}

export const ROLE_META: Record<AppRole, { label: string; description: string }> = {
  viewer: { label: "Viewer", description: "Read-only access to jobs, queue and reporting." },
  operator: { label: "Operator", description: "Create, edit and archive jobs; manage assignments." },
  admin: { label: "Admin", description: "Full control, including portals, routing, integrations and users." },
};
