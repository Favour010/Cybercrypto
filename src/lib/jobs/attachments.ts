/**
 * Server-side validation for uploaded job attachments. The browser-supplied
 * MIME type and file name are not trusted: the type is detected from the
 * file's first bytes, and names are reduced to a safe ASCII form.
 */
import { createHash, randomBytes } from "node:crypto";

import {
  ATTACHMENT_BUCKET,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  MAX_TOTAL_ATTACHMENT_BYTES,
} from "@/lib/jobs/attachments-limits";

export { ATTACHMENT_BUCKET, MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES, MAX_TOTAL_ATTACHMENT_BYTES };

import { detectAttachmentType, sanitizeFileName, type AttachmentType } from "@/lib/jobs/attachments-detect";

export {
  ALLOWED_ATTACHMENT_TYPES,
  ATTACHMENT_ACCEPT,
  detectAttachmentType,
  sanitizeFileName,
  type AttachmentType,
} from "@/lib/jobs/attachments-detect";

export interface ValidatedAttachment {
  fileName: string;
  contentType: AttachmentType;
  bytes: Uint8Array;
  sizeBytes: number;
  sha256: string;
}

export type AttachmentValidation = { ok: true; files: ValidatedAttachment[] } | { ok: false; error: string };

/** Validate the files from a form submission (empty file inputs are ignored). */
export async function validateAttachments(entries: FormDataEntryValue[]): Promise<AttachmentValidation> {
  const files = entries.filter(
    (e): e is File => typeof e === "object" && e !== null && "arrayBuffer" in e && e.size > 0,
  );
  if (files.length > MAX_ATTACHMENTS) return { ok: false, error: `Attach at most ${MAX_ATTACHMENTS} files.` };
  const total = files.reduce((s, f) => s + f.size, 0);
  if (total > MAX_TOTAL_ATTACHMENT_BYTES) {
    return { ok: false, error: `Attachments may total at most ${MAX_TOTAL_ATTACHMENT_BYTES / 1024 / 1024} MB.` };
  }

  const out: ValidatedAttachment[] = [];
  for (const file of files) {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      return { ok: false, error: `"${file.name}" is larger than ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB.` };
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength !== file.size) return { ok: false, error: `"${file.name}" could not be read completely.` };
    const type = detectAttachmentType(bytes);
    if (!type) {
      return {
        ok: false,
        error: `"${file.name}" is not an allowed file type (JPEG, PNG, WebP, HEIC, PDF or plain text).`,
      };
    }
    out.push({
      fileName: sanitizeFileName(file.name, type),
      contentType: type,
      bytes,
      sizeBytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  return { ok: true, files: out };
}

/** `<organisation>/<job>/<random>-<name>`: the layout Storage RLS and the DB check expect. */
export function attachmentPath(organisationId: string, jobId: string, fileName: string): string {
  return `${organisationId}/${jobId}/${randomBytes(4).toString("hex")}-${fileName}`;
}
