import { describe, expect, it } from "vitest";

import { assertSafeUrl, isPublicAddress, UnsafeUrlError } from "@/lib/net/safe-fetch";

describe("isPublicAddress", () => {
  it("rejects private, loopback, link-local and metadata addresses", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "::1",
      "fd00::1",
      "fe80::1",
      "::ffff:10.0.0.1",
    ]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
  });
  it("accepts public addresses", () => {
    expect(isPublicAddress("93.184.216.34")).toBe(true);
    expect(isPublicAddress("2606:4700::1111")).toBe(true);
  });
});

describe("assertSafeUrl", () => {
  const rejects = (url: string, hosts?: string[]) =>
    expect(assertSafeUrl(url, hosts)).rejects.toBeInstanceOf(UnsafeUrlError);
  it("only allows https on the standard port, without credentials", async () => {
    await rejects("http://example.com");
    await rejects("https://example.com:8443/x");
    await rejects("https://user:pass@example.com");
    await rejects("not a url");
  });
  it("blocks literal internal addresses", async () => {
    await rejects("https://127.0.0.1/");
    await rejects("https://169.254.169.254/latest/meta-data");
    await rejects("https://[::1]/");
  });
  it("enforces the host allow-list", async () => {
    await rejects("https://evil.example.com/", ["jobsync-portal-tracker.lovable.app"]);
  });
});
