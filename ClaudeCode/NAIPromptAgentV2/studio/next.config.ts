import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "sharp"],
  // The auth middleware buffers request bodies (default cap 10 MB); 48 MP phone photos run ~20–25 MB.
  experimental: { proxyClientMaxBodySize: "40mb" },
  // Phone over Tailscale/LAN must be allowed to load dev resources (Next 16 blocks otherwise).
  allowedDevOrigins: ["big-mac-mini.tail57826e.ts.net", "*.ts.net", "*.local"],
};

export default nextConfig;
