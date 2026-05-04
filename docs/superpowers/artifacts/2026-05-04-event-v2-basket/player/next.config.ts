import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  output: "standalone",
  turbopack: {
    root: path.resolve(__dirname),
  },
  async headers() {
    return [
      {
        // HTML pages: never cache. Already covered by Next.js defaults but
        // some kiosk browsers ignore those — explicit headers force compliance.
        source: "/:path*",
        headers: [
          { key: "Cache-Control", value: "private, no-cache, no-store, max-age=0, must-revalidate" },
        ],
        missing: [
          { type: "header", key: "sec-fetch-dest", value: "script|style|image|font" },
        ],
      },
      {
        // Static chunks have content-hashed filenames so they're safe to cache,
        // but cap at 1h for kiosk recovery if a deploy ever needs to invalidate.
        source: "/_next/static/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=3600, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
