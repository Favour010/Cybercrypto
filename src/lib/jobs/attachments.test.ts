import { describe, expect, it } from "vitest";

import { attachmentPath, detectAttachmentType, sanitizeFileName, validateAttachments } from "@/lib/jobs/attachments";

const bytes = (...b: number[]) => new Uint8Array(b);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10);
const PDF = new TextEncoder().encode("%PDF-1.7\n...");
const EXE = bytes(0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00); // "MZ" Windows executable

describe("detectAttachmentType", () => {
  it("identifies files by their content, not their name", () => {
    expect(detectAttachmentType(PNG)).toBe("image/png");
    expect(detectAttachmentType(JPEG)).toBe("image/jpeg");
    expect(detectAttachmentType(PDF)).toBe("application/pdf");
    expect(detectAttachmentType(new TextEncoder().encode("Meter reading: 1234 kWh ✓"))).toBe("text/plain");
    expect(detectAttachmentType(EXE)).toBeNull();
    expect(detectAttachmentType(new Uint8Array())).toBeNull();
  });
});

describe("sanitizeFileName", () => {
  it("removes paths and unsafe characters and fixes the extension", () => {
    expect(sanitizeFileName("../../etc/passwd", "text/plain")).toBe("passwd.txt");
    expect(sanitizeFileName("C:\\Users\\me\\Unit photo (1).JPG", "image/jpeg")).toBe("Unit-photo-1.jpg");
    expect(sanitizeFileName("café report.pdf", "application/pdf")).toBe("cafe-report.pdf");
    expect(sanitizeFileName("invoice.pdf.exe", "application/pdf")).toBe("invoice.pdf.pdf");
    expect(sanitizeFileName("....", "image/png")).toBe("attachment.png");
  });
});

describe("validateAttachments", () => {
  const file = (content: Uint8Array, name: string, type = "application/octet-stream") =>
    new File([content as BlobPart], name, { type });

  it("accepts allowed files, ignoring empty inputs, and hashes them", async () => {
    const r = await validateAttachments([file(PNG, "site.png"), new File([], ""), "not-a-file"]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.files).toHaveLength(1);
      expect(r.files[0]).toMatchObject({ fileName: "site.png", contentType: "image/png", sizeBytes: PNG.length });
      expect(r.files[0].sha256).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it("rejects disguised executables", async () => {
    const r = await validateAttachments([file(EXE, "photo.jpg", "image/jpeg")]);
    expect(r).toMatchObject({ ok: false });
  });

  it("enforces count and size limits", async () => {
    const many = Array.from({ length: 11 }, (_, i) => file(PNG, `p${i}.png`));
    expect((await validateAttachments(many)).ok).toBe(false);
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    big.set(PDF);
    expect((await validateAttachments([file(big, "big.pdf")])).ok).toBe(false);
  });
});

describe("attachmentPath", () => {
  it("places files under organisation/job", () => {
    expect(attachmentPath("org-1", "job-1", "a.png")).toMatch(/^org-1\/job-1\/[a-f0-9]{8}-a\.png$/);
  });
});
