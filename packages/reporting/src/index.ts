import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type {
  PlanApproval,
  QaRequest,
  QaRun,
  Report,
  RepositoryAnalysis,
  TestPlan,
  TestResult,
} from "@qa/schemas";
import { reportSchema } from "@qa/schemas";
import { redact, redactUrl, safeFilename } from "@qa/security";
import { nowIso } from "@qa/shared";

const resultTotalKey = {
  PASS: "passed",
  FAIL: "failed",
  BLOCKED: "blocked",
  WARNING: "warning",
  NEEDS_HUMAN_REVIEW: "humanReview",
  NOT_EXECUTED: "notExecuted",
} satisfies Record<TestResult["status"], string>;

export function calculateTotals(plan: TestPlan, run: QaRun) {
  const totals: Record<string, number> = {
    total: plan.items.length,
    valid: 0,
    invalid: 0,
    approved: 0,
    executed: 0,
    passed: 0,
    failed: 0,
    blocked: 0,
    warning: 0,
    humanReview: 0,
    notExecuted: 0,
  };
  for (const item of plan.items) {
    if (item.steps.length === 0 || item.validationWarnings.length > 0) {
      totals.invalid = (totals.invalid ?? 0) + 1;
    } else {
      totals.valid = (totals.valid ?? 0) + 1;
    }
    if (item.approved && !item.rejected) totals.approved = (totals.approved ?? 0) + 1;
  }
  for (const result of run.results) {
    if (result.status !== "NOT_EXECUTED") totals.executed = (totals.executed ?? 0) + 1;
    const key = resultTotalKey[result.status];
    totals[key] = (totals[key] ?? 0) + 1;
  }
  return totals;
}

export function calculateTimeSaved(estimatedManualMinutes: number, automatedDurationMs: number) {
  return Math.max(0, Math.round((estimatedManualMinutes - automatedDurationMs / 60_000) * 10) / 10);
}

export function createReport(input: {
  request: QaRequest;
  plan: TestPlan;
  approval: PlanApproval;
  run: QaRun;
  analysis?: RepositoryAnalysis;
}): Report {
  const approvedItems = input.plan.items.filter((item) => item.approved && !item.rejected);
  const estimatedManualMinutes =
    input.request.estimatedManualMinutes ??
    approvedItems.reduce((sum, item) => sum + item.estimatedManualMinutes, 0);
  const automatedDurationMs = input.run.results.reduce((sum, result) => sum + result.durationMs, 0);
  const report = {
    schemaVersion: "report/v1",
    runId: input.run.id,
    applicationName: input.request.applicationName,
    environment: input.request.environment,
    redactedBaseUrl: redactUrl(input.request.baseUrl),
    objective: input.request.objective,
    repositoryIdentity: input.analysis?.repositoryIdentity,
    repositoryCommit: input.analysis?.commitSha,
    planVersion: input.plan.version,
    approval: input.approval,
    totals: calculateTotals(input.plan, input.run),
    automatedDurationMs,
    estimatedManualMinutes,
    estimatedTimeSavedMinutes: calculateTimeSaved(estimatedManualMinutes, automatedDurationMs),
    estimateNotice: "Testing time saved is an estimate based on user-supplied manual duration.",
    coverageNotice:
      "Coverage accounts for entered and approved cases only; it does not claim coverage of every theoretical software edge case.",
    results: input.run.results,
    generatedAt: nowIso(),
  };
  return reportSchema.parse(redact(report));
}

export function reportMarkdown(report: Report) {
  const lines = [
    `# QA report — ${report.applicationName}`,
    "",
    `- Run: ${report.runId}`,
    `- Environment: ${report.environment}`,
    `- Target: ${report.redactedBaseUrl}`,
    `- Plan version: ${report.planVersion}`,
    `- Automated duration: ${(report.automatedDurationMs / 1000).toFixed(1)} seconds`,
    `- Estimated manual duration: ${report.estimatedManualMinutes} minutes`,
    `- Estimated time saved: ${report.estimatedTimeSavedMinutes} minutes`,
    "",
    `> ${report.coverageNotice}`,
    "",
    "## Totals",
    "",
    ...Object.entries(report.totals).map(([key, value]) => `- ${key}: ${value}`),
    "",
    "## Results",
    "",
  ];
  for (const result of report.results) {
    lines.push(
      `### ${result.testId}: ${result.status}`,
      "",
      `Expected: ${result.expectedResult}`,
      "",
      `Actual: ${result.actualResult}`,
      "",
      `Duration: ${result.durationMs} ms; retries: ${result.retryCount}`,
      "",
      ...result.evidence.map(
        (item) => `- ${item.type}: ${item.available ? item.path : item.unavailableReason}`,
      ),
      "",
    );
  }
  return lines.join("\n");
}

export async function writeReports(root: string, report: Report) {
  const directory = resolve(root, safeFilename(report.runId));
  await mkdir(directory, { recursive: true });
  const jsonPath = join(directory, "report.json");
  const markdownPath = join(directory, "report.md");
  const htmlPath = join(directory, "report.html");
  const markdown = reportMarkdown(report);
  await Promise.all([
    writeFile(jsonPath, JSON.stringify(report, null, 2), { mode: 0o600 }),
    writeFile(markdownPath, markdown, { mode: 0o600 }),
    writeFile(
      htmlPath,
      `<!doctype html><meta charset="utf-8"><title>QA report</title><style>body{font:16px system-ui;max-width:900px;margin:40px auto;padding:0 20px;line-height:1.5}pre{white-space:pre-wrap}</style><pre>${escapeHtml(markdown)}</pre>`,
      { mode: 0o600 },
    ),
  ]);
  return { jsonPath, markdownPath, htmlPath };
}

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"]/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]!,
  );
}
