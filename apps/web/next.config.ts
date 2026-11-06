import type { NextConfig } from "next";

const config: NextConfig = {
  devIndicators: false,
  agentRules: false,
  async rewrites() {
    const apiOrigin = new URL(process.env.AGENTHIRE_API_ORIGIN ?? "http://localhost:3001").origin;
    return [
      { source: "/api/marketplace/:path*", destination: `${apiOrigin}/api/marketplace/:path*` },
      { source: "/api/orchestrator/:path*", destination: `${apiOrigin}/api/orchestrator/:path*` },
    ];
  },
};

export default config;
