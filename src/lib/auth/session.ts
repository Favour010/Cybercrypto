import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { cache } from "react";

import { isDevAuthBypassActive, missingAuthConfig } from "@/lib/auth/config";
import { can, isAppRole, type AppRole, type Permission } from "@/lib/auth/permissions";
import { isMissingRelation } from "@/lib/data/result";
import { createSessionClient } from "@/lib/supabase/server";

export interface SessionUser {
  id: string;
  email: string;
  fullName: string | null;
  role: AppRole;
  organisationId: string;
  organisationName: string | null;
}

export type AuthState =
  | { kind: "authenticated"; user: SessionUser; supabase: SupabaseClient }
  /** Local development only (see isDevAuthBypassActive); never in production builds. */
  | { kind: "dev_bypass"; user: SessionUser; supabase: null }
  | { kind: "unauthenticated" }
  | { kind: "not_configured"; missing: string[] }
  /** Signed in, but no usable profile: deactivated, missing, or schema not applied. */
  | { kind: "no_profile"; reason: "inactive" | "missing" | "schema_missing" };

export type ActiveAuth = Extract<AuthState, { kind: "authenticated" | "dev_bypass" }>;

const DEV_BYPASS_USER: SessionUser = {
  id: "00000000-0000-0000-0000-000000000000",
  email: "developer@localhost",
  fullName: "Local developer (auth bypassed)",
  role: "admin",
  organisationId: "00000000-0000-0000-0000-000000000000",
  organisationName: "Local development",
};

interface ProfileRow {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  is_active: boolean;
  organisation_id: string;
  organisations: { name: string } | null;
}

/**
 * The single source of truth for "who is making this request". Verifies the
 * session with Supabase Auth (getUser() contacts the auth server; cookies alone
 * are never trusted) and loads the user's profile and role. Memoised per request.
 */
export const getAuthState = cache(async (): Promise<AuthState> => {
  const supabase = await createSessionClient();
  if (!supabase) {
    if (isDevAuthBypassActive()) return { kind: "dev_bypass", user: DEV_BYPASS_USER, supabase: null };
    return { kind: "not_configured", missing: missingAuthConfig() };
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return { kind: "unauthenticated" };

  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, is_active, organisation_id, organisations(name)")
    .eq("id", userData.user.id)
    .maybeSingle<ProfileRow>();

  if (error) {
    if (isMissingRelation(error)) return { kind: "no_profile", reason: "schema_missing" };
    console.error("[auth] profile lookup failed", error.code, error.message);
    return { kind: "no_profile", reason: "missing" };
  }
  if (!data) return { kind: "no_profile", reason: "missing" };
  if (!data.is_active || !isAppRole(data.role)) return { kind: "no_profile", reason: "inactive" };

  return {
    kind: "authenticated",
    supabase,
    user: {
      id: data.id,
      email: data.email,
      fullName: data.full_name,
      role: data.role,
      organisationId: data.organisation_id,
      organisationName: data.organisations?.name ?? null,
    },
  };
});

/** For pages: returns an active session or redirects to the right place. */
export async function requireUser(): Promise<ActiveAuth> {
  const state = await getAuthState();
  switch (state.kind) {
    case "authenticated":
    case "dev_bypass":
      return state;
    case "not_configured":
      redirect("/setup");
    case "unauthenticated":
      redirect("/login");
    case "no_profile":
      redirect(`/auth/error?reason=${state.reason}`);
  }
}

export type AuthorizeResult = { ok: true; auth: ActiveAuth } | { ok: false; status: 401 | 403; message: string };

/** For server actions and route handlers: never redirects, returns a result. */
export async function authorize(permission: Permission): Promise<AuthorizeResult> {
  const state = await getAuthState();
  if (state.kind !== "authenticated" && state.kind !== "dev_bypass") {
    return { ok: false, status: 401, message: "Sign in required." };
  }
  if (!can(state.user.role, permission)) {
    return { ok: false, status: 403, message: "Your role does not permit this action." };
  }
  return { ok: true, auth: state };
}
