import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@qa/schemas": resolve("packages/schemas/src/index.ts"),
      "@qa/shared": resolve("packages/shared/src/index.ts"),
      "@qa/security": resolve("packages/security/src/index.ts"),
      "@qa/repository-connectors": resolve("packages/repository-connectors/src/index.ts"),
      "@qa/repository-analysis": resolve("packages/repository-analysis/src/index.ts"),
      "@qa/test-planning": resolve("packages/test-planning/src/index.ts"),
      "@qa/persistence": resolve("packages/persistence/src/index.ts"),
      "@qa/evidence": resolve("packages/evidence/src/index.ts"),
      "@qa/reporting": resolve("packages/reporting/src/index.ts"),
      "@qa/qa-runner": resolve("packages/qa-runner/src/index.ts"),
      "@qa/orchestrator": resolve("packages/orchestrator/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    testTimeout: 15_000,
    hookTimeout: 15_000,
    sequence: { concurrent: false },
  },
});
