import "server-only";

import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { getAuthConfig } from "@/lib/auth/config";

/**
 * Per-request Supabase client acting as the signed-in user (anon key + the
 * user's session cookie). Every query made with it is subject to Row Level
 * Security. Returns null when Supabase auth is not configured.
 */
export async function createSessionClient(): Promise<SupabaseClient | null> {
  const config = getAuthConfig();
  if (!config) return null;
  const cookieStore = await cookies();

  return createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // proxy.ts refreshes the session cookie on every request instead.
        }
      },
    },
  });
}
