import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { QaOrchestrator } from "@qa/orchestrator";
import { QaStore } from "@qa/persistence";
import type { QaRequest, QaRun, TestPlan } from "@qa/schemas";
import { getEnvironment } from "@qa/shared";

const repositoryRoot = resolve(".");
const demoRepository = resolve("apps/demo-target");
const outputRoot = resolve("var/pilot-validation");
const databasePath = resolve(outputRoot, "qa.db");
const targetUrl = "http://127.0.0.1:3100";

const environment = getEnvironment({
  ...process.env,
  NODE_ENV: "test",
  QA_DATA_DIR: outputRoot,
  QA_DATABASE_PATH: databasePath,
  QA_ALLOWED_REPOSITORY_ROOTS: repositoryRoot,
  QA_ALLOWED_CONFIGURATION_ROOTS: resolve("config/pilots"),
  QA_ALLOWED_TARGET_HOSTS: "127.0.0.1",
  QA_BROWSER_TIMEOUT_MS: "15000",
  QA_RUN_TIMEOUT_MS: "120000",
  QA_ACTION_RETRIES: "0",
  AI_TEST_PLANNING_ENABLED: "false",
  AI_PROVIDER: undefined,
  AI_MODEL: undefined,
  OPENAI_API_KEY: undefined,
  LOG_LEVEL: "silent",
});

interface WorkflowSummary {
  workflow: string;
  requestId: string;
  planId: string;
  planVersion: number;
  runId: string;
  itemCount: number;
  suggestionCount: number;
  approvedItemIds: string[];
  resultCounts: Record<string, number>;
  reportDirectory: string;
  repositoryWarnings: string[];
}

function gitStatus() {
  return execFileSync("git", ["status", "--porcelain=v1"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
}

async function waitForPlan(orchestrator: QaOrchestrator, store: QaStore, requestId: string) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const plan = store.latestPlanForRequest(requestId);
    if (plan) return plan;
    const latestEvent = orchestrator.jobs.listEvents(requestId).at(-1);
    if (latestEvent && ["failed", "blocked"].includes(latestEvent.phase)) {
      throw new Error(`Repository scan ${latestEvent.phase}: ${latestEvent.message}`);
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`Timed out waiting for plan for ${requestId}`);
}

async function waitForRun(store: QaStore, runId: string) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const run = store.get<QaRun>("runs", runId);
    if (run && ["COMPLETED", "FAILED", "CANCELLED"].includes(run.status)) return run;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`Timed out waiting for run ${runId}`);
}

function countResults(run: QaRun) {
  return run.results.reduce<Record<string, number>>((counts, result) => {
    counts[result.status] = (counts[result.status] ?? 0) + 1;
    return counts;
  }, {});
}

async function executeWorkflow(
  orchestrator: QaOrchestrator,
  store: QaStore,
  input: Omit<QaRequest, "schemaVersion" | "id" | "createdAt">,
  approvedLimit: number,
) {
  const request = orchestrator.createRequest(input);
  let plan: TestPlan;
  if (request.source.mode === "NONE") {
    plan = await orchestrator.createPlan(request.id);
  } else {
    orchestrator.startScan(request.id);
    plan = await waitForPlan(orchestrator, store, request.id);
  }
  const approvedItemIds = plan.items.slice(0, approvedLimit).map((item) => item.id);
  for (const itemId of approvedItemIds) orchestrator.decidePlanItem(plan.id, itemId, "approve");
  orchestrator.approvePlan(plan.id);
  const queued = orchestrator.startRun(plan.id);
  const run = await waitForRun(store, queued.id);
  if (run.status !== "COMPLETED") {
    throw new Error(
      `Workflow ${input.workflow} ended as ${run.status}: ${run.blockerMessage ?? ""}`,
    );
  }
  const analysis = store.latestScanForRequest(request.id);
  return {
    workflow: input.workflow,
    requestId: request.id,
    planId: plan.id,
    planVersion: plan.version,
    runId: run.id,
    itemCount: plan.items.length,
    suggestionCount: plan.suggestions.length,
    approvedItemIds,
    resultCounts: countResults(run),
    reportDirectory: resolve(outputRoot, "reports", run.id),
    repositoryWarnings: analysis?.warnings ?? [],
  } satisfies WorkflowSummary;
}

async function main() {
  await mkdir(outputRoot, { recursive: true });
  const beforeStatus = gitStatus();
  const store = new QaStore(databasePath);
  const orchestrator = new QaOrchestrator(environment, store, {});

  try {
    const summaries = [
      await executeWorkflow(
        orchestrator,
        store,
        {
          workflow: "MANUAL",
          applicationName: "Demo target",
          baseUrl: targetUrl,
          environment: "LOCAL",
          objective: "Validate the supplied URL cases",
          source: { schemaVersion: "repository-source/v1", mode: "NONE" },
          existingCasesText: [
            "1. The Login button is visible.",
            '2. "Welcome back" is visible.',
          ].join("\n"),
        },
        2,
      ),
      await executeWorkflow(
        orchestrator,
        store,
        {
          workflow: "REPOSITORY",
          applicationName: "Demo target",
          baseUrl: targetUrl,
          environment: "LOCAL",
          objective: "Inspect repository routes and propose read-only coverage",
          source: {
            schemaVersion: "repository-source/v1",
            mode: "LOCAL",
            localPath: demoRepository,
          },
          existingCasesText: "",
        },
        2,
      ),
      await executeWorkflow(
        orchestrator,
        store,
        {
          workflow: "REPOSITORY_WITH_CASES",
          applicationName: "Demo target",
          baseUrl: targetUrl,
          environment: "LOCAL",
          objective: "Validate supplied login cases and identify repository-backed gaps",
          source: {
            schemaVersion: "repository-source/v1",
            mode: "LOCAL",
            localPath: demoRepository,
          },
          existingCasesText: [
            "1. The Login button is visible.",
            '2. "Welcome back" is visible.',
          ].join("\n"),
        },
        2,
      ),
      await executeWorkflow(
        orchestrator,
        store,
        {
          workflow: "NO_CASES",
          applicationName: "Demo target",
          baseUrl: targetUrl,
          environment: "LOCAL",
          objective: "The Login button is visible.",
          source: { schemaVersion: "repository-source/v1", mode: "NONE" },
          existingCasesText: "",
        },
        1,
      ),
    ];

    const demoFallback = await executeWorkflow(
      orchestrator,
      store,
      {
        workflow: "MANUAL",
        applicationName: "KOG pilot demo fallback",
        baseUrl: targetUrl,
        environment: "LOCAL",
        objective: "Execute five safe representative checks without KOG access",
        source: { schemaVersion: "repository-source/v1", mode: "NONE" },
        existingCasesText: [
          "1. The Login button is visible.",
          '2. "Welcome back" is visible.',
          '3. "Email" is visible.',
          '4. "Password" is visible.',
          "5. Page loads /login.",
        ].join("\n"),
      },
      5,
    );

    const afterStatus = gitStatus();
    if (beforeStatus !== afterStatus) {
      throw new Error("Repository changed during pilot workflow validation");
    }
    const output = {
      generatedAt: new Date().toISOString(),
      target: targetUrl,
      aiValidation: {
        status: "BLOCKED",
        reason:
          "No OPENAI_API_KEY or confirmed AI_MODEL was available in the approved local secret mechanism.",
        ruleBasedPathPreserved: true,
      },
      repositoryReadOnlyCheck: {
        unchanged: true,
      },
      workflows: summaries,
      kog: {
        mode: "DEMO_FALLBACK",
        reason:
          "No approved KOG non-production URL, repository path, or authentication state was supplied.",
        demoFallback,
      },
    };
    const summaryPath = resolve(outputRoot, "summary.json");
    await writeFile(summaryPath, `${JSON.stringify(output, null, 2)}\n`, { mode: 0o600 });
    process.stdout.write(`${JSON.stringify({ summaryPath, ...output }, null, 2)}\n`);
  } finally {
    store.close();
  }
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
