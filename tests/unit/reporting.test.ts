import { describe, expect, it } from "vitest";
import { calculateTimeSaved, createReport } from "@qa/reporting";
import type { PlanApproval, QaRequest, QaRun, TestPlan, TestResult } from "@qa/schemas";

const now = new Date().toISOString();
const request: QaRequest = {
  schemaVersion: "qa-request/v1",
  id: "request",
  workflow: "MANUAL",
  applicationName: "Demo",
  baseUrl: "http://localhost:3100/?token=secret",
  environment: "LOCAL",
  objective: "Test demo",
  source: { schemaVersion: "repository-source/v1", mode: "NONE" },
  existingCasesText: "",
  createdAt: now,
};
const plan: TestPlan = {
  schemaVersion: "test-plan/v1",
  id: "plan",
  requestId: "request",
  version: 1,
  status: "APPROVED",
  objective: "Test demo",
  items: [],
  suggestions: [],
  createdAt: now,
  updatedAt: now,
};
const approval: PlanApproval = {
  schemaVersion: "plan-approval/v1",
  id: "approval",
  planId: "plan",
  planVersion: 1,
  approvedItemIds: [],
  stagingApprovedItemIds: [],
  approvedBy: "tester",
  approvedAt: now,
};
const run: QaRun = {
  schemaVersion: "qa-run/v1",
  id: "run",
  requestId: "request",
  planId: "plan",
  planVersion: 1,
  rerunMode: "NONE",
  status: "COMPLETED",
  phase: "completed",
  completedTestIds: [],
  results: [],
  createdAt: now,
  cancelRequested: false,
};

describe("report calculations", () => {
  it("never reports negative estimated savings", () => {
    expect(calculateTimeSaved(1, 120_000)).toBe(0);
    expect(calculateTimeSaved(10, 60_000)).toBe(9);
  });

  it("redacts sensitive URL parameters and labels estimates and coverage", () => {
    const report = createReport({ request, plan, approval, run });
    expect(report.redactedBaseUrl).not.toContain("secret");
    expect(report.estimateNotice).toMatch(/estimate/);
    expect(report.coverageNotice).toMatch(/does not claim/);
  });

  it("redacts credential-like strings from machine and human reports", () => {
    const result: TestResult = {
      schemaVersion: "test-result/v1",
      id: "result",
      runId: "run",
      testId: "TEST-001",
      status: "FAIL",
      expectedResult: "Login with person@example.test and password: demo-password",
      actualResult: "Bearer secret-token was rejected",
      evidence: [],
      retryCount: 0,
      durationMs: 1,
      startedAt: now,
      completedAt: now,
    };
    const report = createReport({
      request: { ...request, objective: "Use api_key=sk-example-secret" },
      plan,
      approval,
      run: { ...run, results: [result] },
    });
    expect(JSON.stringify(report)).not.toMatch(
      /person@example\.test|demo-password|secret-token|sk-example-secret/,
    );
  });

  it("counts warned cases as invalid for plan accounting", () => {
    const warnedPlan: TestPlan = {
      ...plan,
      items: [
        {
          schemaVersion: "test-plan-item/v1",
          id: "TEST-001",
          source: "USER",
          title: "Needs deterministic assertion",
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
          expectedResult: "A human reviews the page",
          assertionType: "captureScreenshot",
          sideEffectLevel: "READ_ONLY",
          estimatedManualMinutes: 2,
          rationale: "User supplied",
          repositoryEvidence: [],
          validationWarnings: ["No deterministic assertion was inferred"],
          approved: false,
          rejected: false,
          requiresStagingApproval: false,
        },
      ],
    };
    const report = createReport({ request, plan: warnedPlan, approval, run });
    expect(report.totals.valid).toBe(0);
    expect(report.totals.invalid).toBe(1);
  });
});
