import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    'better-sqlite3',
    'duckdb',
  ],
};

export default nextConfig;
