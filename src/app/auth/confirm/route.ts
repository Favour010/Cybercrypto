import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { safeNextPath } from "@/lib/auth/routes";
import { createSessionClient } from "@/lib/supabase/server";

const ALLOWED_TYPES: EmailOtpType[] = ["invite", "recovery", "email", "email_change"];

/**
 * Landing point for Supabase invitation and password-recovery emails
 * (email templates must link to /auth/confirm?token_hash=…&type=…).
 * Invited and recovering users are sent on to set a password.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;

  const supabase = await createSessionClient();
  if (!supabase || !tokenHash || !type || !ALLOWED_TYPES.includes(type)) {
    return NextResponse.redirect(new URL("/auth/error?reason=link", request.url));
  }

  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error) return NextResponse.redirect(new URL("/auth/error?reason=link", request.url));

  const destination =
    type === "invite" || type === "recovery" ? "/account/password" : safeNextPath(url.searchParams.get("next"));
  return NextResponse.redirect(new URL(destination, request.url));
}
