import { describe, expect, it } from "vitest";
import type { QaRequest, RepositoryAnalysis } from "@qa/schemas";
import {
  createCandidatePlan,
  createPlanningAdapter,
  OpenAIPlanningAdapter,
} from "@qa/test-planning";

const request: QaRequest = {
  schemaVersion: "qa-request/v1",
  id: "request-ai",
  workflow: "MANUAL",
  applicationName: "Demo",
  baseUrl: "http://localhost:3100",
  environment: "LOCAL",
  objective: "Verify the login experience",
  source: { schemaVersion: "repository-source/v1", mode: "NONE" },
  existingCasesText: "",
  createdAt: new Date().toISOString(),
};

const analysis: RepositoryAnalysis = {
  schemaVersion: "repository-analysis/v1",
  id: "analysis-ai",
  requestId: request.id,
  status: "COMPLETED",
  connectorType: "LOCAL",
  repositoryIdentity: "demo/repository",
  packageManager: "pnpm",
  frameworks: ["Next.js"],
  scripts: {},
  routes: [{ path: "apps/web/app/login/page.tsx", line: 1, reason: "App route" }],
  components: [],
  changedFiles: [],
  hasUncommittedChanges: false,
  existingTests: [],
  riskAreas: ["Authentication"],
  warnings: [],
  evidence: [{ path: "apps/web/app/login/page.tsx", line: 1, reason: "Login route" }],
  cacheKey: "cache-ai",
  scannedAt: new Date().toISOString(),
};

const validParsed = {
  cases: [
    {
      title: "Login button is visible",
      category: "Authentication",
      route: "/login",
      expectedResult: "The Login button is visible",
      rationale: "Covers the primary login entry point",
      evidencePaths: ["apps/web/app/login/page.tsx"],
      steps: [
        {
          type: "assertElementVisible",
          path: null,
          strategy: "role",
          role: "button",
          name: "Login",
          value: null,
        },
      ],
    },
  ],
};

function options(completion: () => Promise<unknown>) {
  return {
    model: "configured-test-model",
    timeoutMs: 1_000,
    maxInputFiles: 10,
    maxInputBytes: 10_000,
    completion,
  };
}

describe("OpenAI planning", () => {
  it("accepts a valid structured result and grounds repository evidence", async () => {
    let prompt = "";
    const adapter = new OpenAIPlanningAdapter(
      options(async (input?: unknown) => {
        prompt = JSON.stringify(input);
        return { choices: [{ message: { parsed: validParsed } }] };
      }),
    );
    const cases = await adapter.createCases({
      objective: request.objective,
      text: request.objective,
      analysis,
    });

    expect(cases[0]).toMatchObject({
      source: "AI_SUGGESTED",
      approved: false,
      repositoryEvidence: [{ path: "apps/web/app/login/page.tsx" }],
    });
    expect(prompt).toContain("apps/web/app/login/page.tsx");
  });

  it("rejects malformed output and model-supplied PASS claims", async () => {
    const adapter = new OpenAIPlanningAdapter(
      options(async () => ({
        choices: [
          {
            message: {
              parsed: {
                cases: [{ ...validParsed.cases[0], status: "PASS", steps: [] }],
              },
            },
          },
        ],
      })),
    );

    await expect(
      adapter.createCases({ objective: request.objective, text: request.objective }),
    ).rejects.toThrow();
  });

  it("uses a clear rule-based fallback when credentials are missing", async () => {
    const adapter = createPlanningAdapter({
      enabled: true,
      provider: "openai",
      model: "configured-test-model",
      timeoutMs: 1_000,
      maxInputFiles: 10,
      maxInputBytes: 10_000,
    });
    const cases = await adapter.createCases({
      objective: request.objective,
      text: "The Login button is visible.",
    });

    expect(cases[0]?.source).toBe("RULE_BASED");
    expect(cases[0]?.validationWarnings.join(" ")).toContain("OPENAI_API_KEY is not configured");
  });

  it("falls back safely when the provider call fails", async () => {
    const adapter = createPlanningAdapter({
      enabled: true,
      provider: "openai",
      model: "configured-test-model",
      timeoutMs: 1_000,
      maxInputFiles: 10,
      maxInputBytes: 10_000,
      completion: async () => {
        throw new Error("provider unavailable");
      },
    });
    const cases = await adapter.createCases({
      objective: request.objective,
      text: "The Login button is visible.",
    });

    expect(cases[0]).toMatchObject({ source: "RULE_BASED", approved: false });
    expect(cases[0]?.validationWarnings.join(" ")).toContain("provider unavailable");
  });

  it("preserves user cases and keeps AI gaps separate and unapproved", async () => {
    const adapter = createPlanningAdapter({
      enabled: true,
      provider: "openai",
      model: "configured-test-model",
      timeoutMs: 1_000,
      maxInputFiles: 10,
      maxInputBytes: 10_000,
      completion: async () => ({ choices: [{ message: { parsed: validParsed } }] }),
    });
    const plan = await createCandidatePlan({
      request: {
        ...request,
        existingCasesText: "1. The Dashboard link is visible.",
      },
      analysis,
      adapter,
    });

    expect(plan.items[0]).toMatchObject({
      title: "The Dashboard link is visible",
      source: "USER",
    });
    expect(plan.suggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "Login button is visible", approved: false }),
      ]),
    );
    expect(plan.suggestions.every((item) => !item.approved)).toBe(true);
  });
});
