import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    // Job attachments are uploaded through server actions: up to 25 MiB per
    // submission (validated in src/lib/jobs/attachments.ts) plus multipart
    // overhead. The proxy must buffer at least as much, or bodies are cut short.
    serverActions: { bodySizeLimit: "27mb" },
    proxyClientMaxBodySize: "27mb",
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
