import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "esbuild",
    "jsdom",
    "sql.js",
    "@newt/db",
    "@newt/compiler",
    "@newt/agents",
    "@newt/contract",
    "@newt/base-sdk",
    "@newt/base-xkmato",
  ],
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve = config.resolve ?? {};
      config.resolve.fallback = {
        ...(config.resolve.fallback ?? {}),
        fs: false,
        path: false,
        crypto: false,
      };
    }
    return config;
  },
};

export default nextConfig;
