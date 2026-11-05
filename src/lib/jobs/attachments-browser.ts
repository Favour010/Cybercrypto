/**
 * Browser-side attachment validation for the demo data layer: the same limits
 * and content-based type detection as the server (src/lib/jobs/attachments.ts),
 * hashed with Web Crypto instead of Node's crypto.
 */
import { detectAttachmentType, sanitizeFileName, type AttachmentType } from "@/lib/jobs/attachments-detect";
import { MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES, MAX_TOTAL_ATTACHMENT_BYTES } from "@/lib/jobs/attachments-limits";

export interface BrowserAttachment {
  fileName: string;
  contentType: AttachmentType;
  blob: Blob;
  sizeBytes: number;
  sha256: string;
}

export async function validateAttachmentsInBrowser(
  entries: FormDataEntryValue[],
): Promise<{ ok: true; files: BrowserAttachment[] } | { ok: false; error: string }> {
  const files = entries.filter(
    (e): e is File => typeof e === "object" && e !== null && "arrayBuffer" in e && e.size > 0,
  );
  if (files.length > MAX_ATTACHMENTS) return { ok: false, error: `Attach at most ${MAX_ATTACHMENTS} files.` };
  if (files.reduce((n, f) => n + f.size, 0) > MAX_TOTAL_ATTACHMENT_BYTES) {
    return { ok: false, error: `Attachments may total at most ${MAX_TOTAL_ATTACHMENT_BYTES / 1048576} MB.` };
  }
  const out: BrowserAttachment[] = [];
  for (const file of files) {
    if (file.size > MAX_ATTACHMENT_BYTES)
      return { ok: false, error: `"${file.name}" is larger than ${MAX_ATTACHMENT_BYTES / 1048576} MB.` };
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    const type = detectAttachmentType(bytes);
    if (!type)
      return {
        ok: false,
        error: `"${file.name}" is not an allowed file type (JPEG, PNG, WebP, HEIC, PDF or plain text).`,
      };
    const digest = await crypto.subtle.digest("SHA-256", buf);
    out.push({
      fileName: sanitizeFileName(file.name, type),
      contentType: type,
      blob: new Blob([buf], { type }),
      sizeBytes: bytes.byteLength,
      sha256: Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join(""),
    });
  }
  return { ok: true, files: out };
}
