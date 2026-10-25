import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the assignment workspace free of generated agent rule files.
  agentRules: false,
  cacheComponents: true,
  partialPrefetching: true,
  // Include the committed local RAG index in serverless function traces.
  outputFileTracingIncludes: {
    "/api/**/*": ["./data/colmobil-*.json", "./corpus/colmobil/*"],
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
