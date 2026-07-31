import { z } from "zod";

export const runStatuses = [
  "DRAFT",
  "WAITING_FOR_APPROVAL",
  "APPROVED",
  "QUEUED",
  "SCANNING",
  "PLANNING",
  "RUNNING",
  "REPORTING",
  "COMPLETED",
  "CANCELLED",
  "FAILED",
] as const;

export const resultStatuses = [
  "PASS",
  "FAIL",
  "WARNING",
  "BLOCKED",
  "NEEDS_HUMAN_REVIEW",
  "NOT_EXECUTED",
] as const;

export const sideEffectLevels = [
  "READ_ONLY",
  "LOCAL_MUTATION",
  "STAGING_TEST_DATA",
  "EXTERNAL_SIDE_EFFECT",
  "PRODUCTION_MUTATION",
] as const;

export const caseSources = [
  "USER",
  "RULE_BASED",
  "REPOSITORY_ANALYSIS",
  "AI_SUGGESTED",
  "EXISTING_AUTOMATED_TEST",
] as const;

export const selectorStrategies = ["role", "label", "text", "testId", "placeholder"] as const;

export const actionTypes = [
  "goto",
  "click",
  "fill",
  "selectOption",
  "check",
  "uncheck",
  "press",
  "waitForElement",
  "assertTextVisible",
  "assertExactText",
  "assertElementVisible",
  "assertElementHidden",
  "assertElementEnabled",
  "assertElementDisabled",
  "assertUrlEquals",
  "assertUrlContains",
  "assertPageTitle",
  "assertFieldValidation",
  "captureScreenshot",
] as const;

const selectorActions = new Set<(typeof actionTypes)[number]>([
  "click",
  "fill",
  "selectOption",
  "check",
  "uncheck",
  "waitForElement",
  "assertTextVisible",
  "assertExactText",
  "assertElementVisible",
  "assertElementHidden",
  "assertElementEnabled",
  "assertElementDisabled",
  "assertFieldValidation",
]);

export const actionSchema = z
  .object({
    type: z.enum(actionTypes),
    path: z.string().max(2048).optional(),
    strategy: z.enum(selectorStrategies).optional(),
    role: z.string().max(100).optional(),
    name: z.string().max(300).optional(),
    value: z.string().max(5000).optional(),
    option: z.string().max(500).optional(),
    key: z.enum(["Enter", "Tab", "Escape", "Space", "ArrowDown", "ArrowUp"]).optional(),
    timeoutMs: z.number().int().min(100).max(120_000).default(10_000),
    redactValue: z.boolean().default(false),
    errorClassification: z
      .enum(["ASSERTION", "NAVIGATION", "SELECTOR", "TIMEOUT", "SAFETY"])
      .default("ASSERTION"),
  })
  .superRefine((action, ctx) => {
    if (action.type === "goto" && !action.path) {
      ctx.addIssue({ code: "custom", message: "goto requires path", path: ["path"] });
    }
    if (selectorActions.has(action.type) && (!action.strategy || !action.name)) {
      ctx.addIssue({
        code: "custom",
        message: `${action.type} requires selector strategy and name`,
        path: ["strategy"],
      });
    }
    if (action.type === "fill" && action.value === undefined) {
      ctx.addIssue({ code: "custom", message: "fill requires value", path: ["value"] });
    }
    if (action.type === "press" && !action.key) {
      ctx.addIssue({ code: "custom", message: "press requires an allowlisted key", path: ["key"] });
    }
    if (
      ["assertUrlEquals", "assertUrlContains", "assertPageTitle"].includes(action.type) &&
      !action.value &&
      !action.path &&
      !action.name
    ) {
      ctx.addIssue({
        code: "custom",
        message: `${action.type} requires an expected value`,
        path: ["value"],
      });
    }
  });

const gitRefSchema = z
  .string()
  .max(255)
  .regex(/^(?!-)[A-Za-z0-9._/~^]+$/, "Git ref contains unsupported characters");

const repositorySourceBase = {
  schemaVersion: z.literal("repository-source/v1"),
  ref: gitRefSchema.optional(),
  comparisonRef: gitRefSchema.optional(),
};

export const repositorySourceSchema = z.discriminatedUnion("mode", [
  z.object({ ...repositorySourceBase, mode: z.literal("NONE") }),
  z.object({ ...repositorySourceBase, mode: z.literal("LOCAL"), localPath: z.string().min(1) }),
  z.object({
    ...repositorySourceBase,
    mode: z.literal("GITHUB"),
    githubRepository: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
    pullRequestNumber: z.number().int().positive().optional(),
  }),
]);

export const evidenceReferenceSchema = z.object({
  path: z.string(),
  line: z.number().int().positive().optional(),
  reason: z.string(),
});

export const testPlanItemSchema = z.object({
  schemaVersion: z.literal("test-plan-item/v1"),
  id: z.string().regex(/^TEST-\d{3,}$/),
  source: z.enum(caseSources),
  title: z.string().min(3).max(200),
  category: z.string().min(2).max(100),
  route: z.string().default("/"),
  preconditions: z.array(z.string()).default([]),
  steps: z.array(actionSchema).min(1),
  expectedResult: z.string().min(3),
  assertionType: z.string().min(2),
  sideEffectLevel: z.enum(sideEffectLevels).default("READ_ONLY"),
  estimatedManualMinutes: z.number().nonnegative().max(1440).default(2),
  rationale: z.string().default("User supplied"),
  repositoryEvidence: z.array(evidenceReferenceSchema).default([]),
  validationWarnings: z.array(z.string()).default([]),
  duplicateOf: z.string().optional(),
  approved: z.boolean().default(false),
  rejected: z.boolean().default(false),
  requiresStagingApproval: z.boolean().default(false),
});

export const testPlanSchema = z.object({
  schemaVersion: z.literal("test-plan/v1"),
  id: z.string(),
  requestId: z.string(),
  version: z.number().int().positive(),
  status: z.enum(["DRAFT", "WAITING_FOR_APPROVAL", "APPROVED"]),
  objective: z.string(),
  items: z.array(testPlanItemSchema),
  suggestions: z.array(testPlanItemSchema).default([]),
  approvalInvalidatedAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const qaRequestSchema = z.object({
  schemaVersion: z.literal("qa-request/v1"),
  id: z.string(),
  workflow: z.enum(["MANUAL", "REPOSITORY", "REPOSITORY_WITH_CASES", "NO_CASES"]),
  applicationName: z.string().min(2).max(120),
  baseUrl: z.string().url(),
  environment: z.enum(["LOCAL", "TEST", "STAGING"]),
  objective: z.string().min(3).max(5000),
  source: repositorySourceSchema,
  existingCasesText: z.string().max(50_000).default(""),
  estimatedManualMinutes: z.number().nonnegative().max(100_000).optional(),
  configurationFile: z.string().max(4096).optional(),
  createdAt: z.string().datetime(),
});

export const repositoryAnalysisSchema = z.object({
  schemaVersion: z.literal("repository-analysis/v1"),
  id: z.string(),
  requestId: z.string(),
  status: z.enum(["QUEUED", "SCANNING", "COMPLETED", "BLOCKED", "FAILED"]),
  connectorType: z.enum(["LOCAL", "GITHUB"]),
  repositoryIdentity: z.string(),
  displayPath: z.string().optional(),
  branch: z.string().optional(),
  ref: z.string().optional(),
  commitSha: z.string().optional(),
  packageManager: z.enum(["pnpm", "npm", "yarn", "unknown"]),
  frameworks: z.array(z.string()),
  scripts: z.record(z.string()),
  routes: z.array(evidenceReferenceSchema),
  components: z.array(evidenceReferenceSchema),
  changedFiles: z.array(z.string()),
  hasUncommittedChanges: z.boolean(),
  existingTests: z.array(evidenceReferenceSchema),
  riskAreas: z.array(z.string()),
  warnings: z.array(z.string()),
  evidence: z.array(evidenceReferenceSchema),
  cacheKey: z.string(),
  scannedAt: z.string().datetime(),
});

export const planApprovalSchema = z.object({
  schemaVersion: z.literal("plan-approval/v1"),
  id: z.string(),
  planId: z.string(),
  planVersion: z.number().int().positive(),
  approvedItemIds: z.array(z.string()),
  stagingApprovedItemIds: z.array(z.string()).default([]),
  approvedBy: z.string().min(1),
  approvedAt: z.string().datetime(),
});

export const evidenceItemSchema = z.object({
  schemaVersion: z.literal("evidence-item/v1"),
  id: z.string(),
  runId: z.string(),
  testId: z.string().optional(),
  type: z.enum(["SCREENSHOT", "TRACE", "BROWSER_LOG", "REPORT", "ERROR"]),
  path: z.string(),
  mimeType: z.string(),
  description: z.string(),
  available: z.boolean(),
  unavailableReason: z.string().optional(),
  createdAt: z.string().datetime(),
});

export const testResultSchema = z.object({
  schemaVersion: z.literal("test-result/v1"),
  id: z.string(),
  runId: z.string(),
  testId: z.string(),
  status: z.enum(resultStatuses),
  expectedResult: z.string(),
  actualResult: z.string(),
  evidence: z.array(evidenceItemSchema),
  error: z.string().optional(),
  retryCount: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
});

export const qaRunSchema = z.object({
  schemaVersion: z.literal("qa-run/v1"),
  id: z.string(),
  requestId: z.string(),
  planId: z.string(),
  planVersion: z.number().int().positive(),
  parentRunId: z.string().optional(),
  rerunMode: z.enum(["NONE", "FULL", "FAILURES"]).default("NONE"),
  status: z.enum(runStatuses),
  phase: z.string(),
  currentTestId: z.string().optional(),
  completedTestIds: z.array(z.string()).default([]),
  results: z.array(testResultSchema).default([]),
  createdAt: z.string().datetime(),
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  cancelRequested: z.boolean().default(false),
  blockerMessage: z.string().optional(),
});

export const auditEventSchema = z.object({
  schemaVersion: z.literal("audit-event/v1"),
  id: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  action: z.string(),
  actor: z.string(),
  safeMetadata: z.record(z.unknown()).default({}),
  createdAt: z.string().datetime(),
});

export const reportSchema = z.object({
  schemaVersion: z.literal("report/v1"),
  runId: z.string(),
  applicationName: z.string(),
  environment: z.string(),
  redactedBaseUrl: z.string(),
  objective: z.string(),
  repositoryIdentity: z.string().optional(),
  repositoryCommit: z.string().optional(),
  planVersion: z.number().int().positive(),
  approval: planApprovalSchema,
  totals: z.record(z.number()),
  automatedDurationMs: z.number(),
  estimatedManualMinutes: z.number(),
  estimatedTimeSavedMinutes: z.number(),
  estimateNotice: z.string(),
  coverageNotice: z.string(),
  results: z.array(testResultSchema),
  generatedAt: z.string().datetime(),
});

export type Action = z.infer<typeof actionSchema>;
export type RepositorySource = z.infer<typeof repositorySourceSchema>;
export type TestPlanItem = z.infer<typeof testPlanItemSchema>;
export type TestPlan = z.infer<typeof testPlanSchema>;
export type QaRequest = z.infer<typeof qaRequestSchema>;
export type RepositoryAnalysis = z.infer<typeof repositoryAnalysisSchema>;
export type PlanApproval = z.infer<typeof planApprovalSchema>;
export type EvidenceItem = z.infer<typeof evidenceItemSchema>;
export type TestResult = z.infer<typeof testResultSchema>;
export type QaRun = z.infer<typeof qaRunSchema>;
export type AuditEvent = z.infer<typeof auditEventSchema>;
export type Report = z.infer<typeof reportSchema>;
