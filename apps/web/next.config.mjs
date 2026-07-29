/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  transpilePackages: [
    "@qa/orchestrator",
    "@qa/persistence",
    "@qa/reporting",
    "@qa/schemas",
    "@qa/security",
    "@qa/shared",
    "@qa/test-planning",
  ],
  serverExternalPackages: ["@playwright/test"],
};

export default nextConfig;
