import type { NextConfig } from "next";

const config: NextConfig = {
  devIndicators: false,
  agentRules: false,
  async rewrites() {
    return [
      { source: "/api/marketplace/:path*", destination: "http://localhost:3001/api/marketplace/:path*" },
      { source: "/api/orchestrator/:path*", destination: "http://localhost:3001/api/orchestrator/:path*" },
    ];
  },
};

export default config;
