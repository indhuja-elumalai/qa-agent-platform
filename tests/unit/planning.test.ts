import { describe, expect, it } from "vitest";
import type { QaRequest, TestPlanItem } from "@qa/schemas";
import {
  createCandidatePlan,
  editPlanItem,
  mergeCases,
  RuleBasedPlanningAdapter,
} from "@qa/test-planning";

const request: QaRequest = {
  schemaVersion: "qa-request/v1",
  id: "request-1",
  workflow: "MANUAL",
  applicationName: "Demo",
  baseUrl: "http://localhost:3100",
  environment: "LOCAL",
  objective: "Verify login",
  source: { schemaVersion: "repository-source/v1", mode: "NONE" },
  existingCasesText:
    '1. The Login button is visible.\n2. Invalid credentials show "Invalid credentials".',
  createdAt: new Date().toISOString(),
};

describe("rule-based planning", () => {
  it("parses numbered natural-language cases without AI", async () => {
    const plan = await createCandidatePlan({ request });
    expect(plan.items).toHaveLength(2);
    expect(plan.items[0]?.steps[0]?.type).toBe("assertElementVisible");
    expect(plan.items[0]?.steps[0]?.name).toBe("Login");
    expect(plan.items[1]?.source).toBe("USER");
  });

  it("treats an introductory sentence as context when numbered cases follow", async () => {
    const plan = await createCandidatePlan({
      request: {
        ...request,
        existingCasesText: `Test the local demo login application.

1. The Login button is visible.
2. Empty email displays a required-field validation.
3. Invalid credentials display "Invalid credentials".
4. An unauthenticated visitor cannot access the dashboard.
5. Valid demo credentials open the dashboard.`,
      },
    });
    expect(plan.items).toHaveLength(5);
    expect(plan.items.every((item) => item.source === "USER")).toBe(true);
    expect(plan.items[1]?.steps[0]?.type).toBe("assertTextVisible");
  });

  it("keeps supplied cases and marks duplicates visibly", () => {
    const base = {
      schemaVersion: "test-plan-item/v1",
      source: "USER",
      title: "Login button is visible",
      category: "Functional",
      route: "/",
      preconditions: [],
      steps: [
        {
          type: "captureScreenshot",
          timeoutMs: 1000,
          redactValue: false,
          errorClassification: "ASSERTION",
        },
      ],
      expectedResult: "Visible",
      assertionType: "visual",
      sideEffectLevel: "READ_ONLY",
      estimatedManualMinutes: 2,
      rationale: "User",
      repositoryEvidence: [],
      validationWarnings: [],
      approved: false,
      rejected: false,
      requiresStagingApproval: false,
    } satisfies Omit<TestPlanItem, "id">;
    const merged = mergeCases(
      [
        { ...base, id: "TEST-001" },
        { ...base, id: "TEST-002" },
      ],
      [],
    );
    expect(merged.items).toHaveLength(2);
    expect(merged.items[1]?.duplicateOf).toBe("TEST-001");
  });

  it("caps candidate plans and reports truncation", async () => {
    const plan = await createCandidatePlan({
      request: {
        ...request,
        existingCasesText:
          "1. Login is visible.\n2. Dashboard is visible.\n3. Safe form is visible.",
      },
      maxCases: 2,
    });
    expect(plan.items).toHaveLength(2);
    expect(plan.items[1]?.validationWarnings).toContain(
      "Candidate plan was truncated to the configured limit of 2 cases.",
    );
  });

  it("invalidates approval when a plan item is edited", async () => {
    const plan = await createCandidatePlan({ request, adapter: new RuleBasedPlanningAdapter() });
    const approved = { ...plan, status: "APPROVED" as const };
    const edited = editPlanItem(approved, "TEST-001", { expectedResult: "Exact revised result" });
    expect(edited.status).toBe("WAITING_FOR_APPROVAL");
    expect(edited.version).toBe(2);
    expect(edited.approvalInvalidatedAt).toBeTruthy();
  });

  it("keeps an edited route aligned with an inferred navigation step", async () => {
    const plan = await createCandidatePlan({
      request: {
        ...request,
        existingCasesText: "Visit /login",
      },
    });
    const edited = editPlanItem(plan, "TEST-001", { route: "/safe-form" });
    expect(edited.items[0]?.route).toBe("/safe-form");
    expect(edited.items[0]?.steps[0]).toMatchObject({ type: "goto", path: "/safe-form" });
  });
});
