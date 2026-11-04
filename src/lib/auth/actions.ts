"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { safeNextPath } from "@/lib/auth/routes";
import { createSessionClient } from "@/lib/supabase/server";

export interface SignInState {
  error?: string;
  email?: string;
}

const signInSchema = z.object({
  email: z.email("Enter a valid email address.").max(254),
  password: z.string().min(1, "Enter your password.").max(200),
  next: z.string().max(2000).optional(),
});

export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const parsed = signInSchema.safeParse({
    email: String(formData.get("email") ?? "").trim(),
    password: String(formData.get("password") ?? ""),
    next: formData.get("next") ? String(formData.get("next")) : undefined,
  });
  const email = String(formData.get("email") ?? "").slice(0, 254);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check your details.", email };

  const supabase = await createSessionClient();
  if (!supabase) return { error: "Sign-in is unavailable: authentication is not configured on this server.", email };

  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error) {
    // Supabase Auth rate-limits sign-in attempts per IP and per account.
    if (error.status === 429) return { error: "Too many sign-in attempts. Wait a few minutes and try again.", email };
    // Network failure or auth-server error: say so rather than blaming the credentials.
    if (error.name === "AuthRetryableFetchError" || !error.status || error.status >= 500) {
      console.error("[auth] sign-in service unavailable", error.name, error.status);
      return { error: "The sign-in service could not be reached. Try again shortly.", email };
    }
    // One message for unknown email and wrong password: no account enumeration.
    return { error: "Email or password is incorrect.", email };
  }

  redirect(safeNextPath(parsed.data.next));
}

export async function signOut(): Promise<void> {
  const supabase = await createSessionClient();
  await supabase?.auth.signOut();
  redirect("/login");
}

export interface PasswordState {
  error?: string;
  success?: boolean;
}

const passwordSchema = z
  .object({
    password: z.string().min(12, "Use at least 12 characters.").max(200),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: "The passwords do not match.", path: ["confirm"] });

export async function updatePassword(_prev: PasswordState, formData: FormData): Promise<PasswordState> {
  const parsed = passwordSchema.safeParse({
    password: String(formData.get("password") ?? ""),
    confirm: String(formData.get("confirm") ?? ""),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createSessionClient();
  if (!supabase) return { error: "Authentication is not configured on this server." };
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { error: "Your session has expired. Sign in again." };

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { error: error.message || "The password could not be updated." };
  return { success: true };
}
