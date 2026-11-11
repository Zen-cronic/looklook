import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    // Phone screenshots up to 15 MB reach /api/check (lib/vision/fit.ts scales them down); the proxy's default cap is 10 MB.
    proxyClientMaxBodySize: "16mb",
  },
};

export default nextConfig;
