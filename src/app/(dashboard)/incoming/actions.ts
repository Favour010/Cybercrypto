"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { authorize } from "@/lib/auth/session";
import { generateApiKey } from "@/lib/intake/api-keys";
import { SOURCE_PATTERN } from "@/lib/jobs/schema";

export interface CreateKeyState {
  error?: string;
  /** Plaintext key, returned exactly once. It is never stored or logged. */
  createdKey?: string;
  createdName?: string;
}

const createSchema = z.object({
  name: z.string().trim().min(1, "Give the key a name.").max(100),
  sources: z
    .string()
    .transform((s) =>
      Array.from(
        new Set(
          s
            .split(/[\s,]+/)
            .map((x) => x.trim().toLowerCase())
            .filter(Boolean),
        ),
      ),
    )
    .pipe(
      z
        .array(
          z.string().regex(SOURCE_PATTERN, "Source names use lowercase letters, digits, '-' or '_' (e.g. aroflo)."),
        )
        .min(1, "List at least one source system, e.g. aroflo.")
        .max(20),
    ),
  expires_in_days: z
    .string()
    .optional()
    .transform((v) => (v ? Number.parseInt(v, 10) : null))
    .pipe(z.number().int().min(1).max(730).nullable()),
});

export async function createApiKeyAction(_prev: CreateKeyState, form: FormData): Promise<CreateKeyState> {
  const auth = await authorize("integrations.manage");
  if (!auth.ok) return { error: auth.message };
  const db = auth.auth.supabase;
  if (!db) return { error: "The database is not configured." };

  const parsed = createSchema.safeParse({
    name: form.get("name") ?? "",
    sources: form.get("sources") ?? "",
    expires_in_days: form.get("expires_in_days") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };

  const { key, prefix, hash } = generateApiKey();
  const { error } = await db.from("api_keys").insert({
    organisation_id: auth.auth.user.organisationId,
    name: parsed.data.name,
    key_prefix: prefix,
    key_hash: hash,
    allowed_sources: parsed.data.sources,
    created_by: auth.auth.user.id,
    expires_at: parsed.data.expires_in_days
      ? new Date(Date.now() + parsed.data.expires_in_days * 86_400_000).toISOString()
      : null,
  });
  if (error) {
    console.error("[api-keys] create failed", error.code, error.message);
    return { error: "The key could not be created." };
  }
  refresh();
  return { createdKey: key, createdName: parsed.data.name };
}

export async function revokeApiKeyAction(form: FormData): Promise<void> {
  const auth = await authorize("integrations.manage");
  const id = z.uuid().safeParse(form.get("id"));
  if (!auth.ok || !auth.auth.supabase || !id.success) return;
  const { error } = await auth.auth.supabase
    .from("api_keys")
    .update({ revoked_at: new Date().toISOString(), revoked_by: auth.auth.user.id })
    .eq("id", id.data)
    .is("revoked_at", null);
  if (error) console.error("[api-keys] revoke failed", error.code, error.message);
  refresh();
}
