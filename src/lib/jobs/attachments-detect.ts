/**
 * File-type detection and file-name sanitising for attachments. Pure (no Node
 * APIs) so the server and the browser apply exactly the same checks.
 */
export { ATTACHMENT_ACCEPT } from "@/lib/jobs/attachments-limits";

export const ALLOWED_ATTACHMENT_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "application/pdf": "pdf",
  "text/plain": "txt",
} as const;
export type AttachmentType = keyof typeof ALLOWED_ATTACHMENT_TYPES;

const startsWith = (b: Uint8Array, sig: number[], offset = 0) => sig.every((v, i) => b[offset + i] === v);
const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.slice(from, to));

/** Identify the file type from its signature ("magic bytes"). */
export function detectAttachmentType(bytes: Uint8Array): AttachmentType | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "image/webp";
  if (ascii(bytes, 4, 8) === "ftyp" && ["heic", "heix", "hevc", "mif1", "msf1"].includes(ascii(bytes, 8, 12))) {
    return "image/heic";
  }
  if (ascii(bytes, 0, 5) === "%PDF-") return "application/pdf";
  if (looksLikeText(bytes)) return "text/plain";
  return null;
}

function looksLikeText(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false;
  const sample = bytes.slice(0, 4096);
  if (sample.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(sample.length < bytes.length ? trimPartialUtf8(sample) : sample);
    return true;
  } catch {
    return false;
  }
}

/** Avoid rejecting valid UTF-8 cut mid-character at the sample boundary. */
function trimPartialUtf8(b: Uint8Array): Uint8Array {
  const end = b.length;
  for (let i = 1; i <= 3 && end - i >= 0; i++) {
    const byte = b[end - i];
    if ((byte & 0xc0) === 0xc0) return b.slice(0, end - i);
    if ((byte & 0x80) === 0) break;
  }
  return b;
}

/** Reduce a client file name to a safe, readable ASCII name with the right extension. */
export function sanitizeFileName(name: string, type: AttachmentType): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const ext = ALLOWED_ATTACHMENT_TYPES[type];
  const stem = base
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\.[^.]*$/, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 100);
  return `${stem || "attachment"}.${ext}`;
}
