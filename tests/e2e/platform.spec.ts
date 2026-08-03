import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { QaOrchestrator } from "@qa/orchestrator";
import { QaStore } from "@qa/persistence";
import { PlaywrightQaRunner, type AuthenticationAdapter } from "@qa/qa-runner";
import { testPlanItemSchema, type QaRun } from "@qa/schemas";
import { getEnvironment } from "@qa/shared";

test("creates, approves, executes and reports a chat-derived demo plan", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Plan a QA run" })).toBeVisible();
  await page.getByLabel("Existing cases or chat instructions").fill("The Login button is visible.");
  await page.getByRole("button", { name: /Create candidate plan/ }).click();
  await expect(page.getByRole("heading", { name: "Candidate test plan" })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "Approve case" }).click();
  await page.getByRole("button", { name: /Approve plan & queue run/ }).click();
  await expect(page.getByText("Run complete")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("All deterministic actions and assertions completed")).toBeVisible();
  await expect(page.locator(".resultStatus.PASS")).toHaveText("PASS");
  await expect(page.getByText("Reports generated")).toBeVisible();

  const historyResponse = await request.get("/api/internal/runs");
  const history = (await historyResponse.json()) as { data: QaRun[] };
  const completed = history.data[0]!;
  expect(completed.status).toBe("COMPLETED");
  expect(completed.results[0]?.evidence.map((item) => item.type)).toEqual(
    expect.arrayContaining(["SCREENSHOT", "TRACE", "BROWSER_LOG"]),
  );
  for (const evidence of completed.results[0]?.evidence ?? []) {
    if (evidence.available) await access(evidence.path);
  }
  const reportResponse = await request.get(`/api/internal/runs/${completed.id}/report`);
  const report = await reportResponse.json();
  expect(report.data.totals.passed).toBe(1);
  expect(report.data.estimateNotice).toMatch(/estimate/);
  expect(report.data.estimatedTimeSavedMinutes).toBeGreaterThanOrEqual(0);

  await page.getByRole("button", { name: "Rerun full plan" }).click();
  await expect(page.getByText("Run complete")).toBeHidden();
  await expect(page.getByText("Run complete")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: /Results & history/ }).click();
  await expect(page.getByRole("button", { name: /plan v1 · FULL/ }).first()).toBeVisible();
});

test("demo target enforces login validation and protected routes", async ({ page }) => {
  await page.goto("http://127.0.0.1:3100/dashboard");
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("Email").fill("wrong@example.test");
  await page.getByLabel("Password").fill("wrong");
  await page.getByRole("button", { name: "Login" }).click();
  await expect(page.getByText("Invalid credentials", { exact: true })).toBeVisible();
  await page.getByLabel("Email").fill("demo@example.test");
  await page.getByLabel("Password").fill("demo-password");
  await page.getByRole("button", { name: "Login" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.getByRole("link", { name: /Agent workspace/ }).click();
  await expect(page).toHaveURL(/\/agent$/);
});

test("uses pilot authentication per run without retaining authenticated artifacts", async () => {
  const root = await mkdtemp(join(tmpdir(), "qa-auth-pilot-e2e-"));
  const configurationFile = join(root, "pilot.json");
  await writeFile(
    configurationFile,
    JSON.stringify({
      schemaVersion: "qa-pilot-configuration/v1",
      enabled: true,
      application: { name: "Authenticated demo" },
      environment: {
        kind: "STAGING",
        baseUrlEnv: "PILOT_BASE_URL",
        expectedHost: "127.0.0.1",
      },
      source: { mode: "NONE" },
      auth: {
        adapter: "environment-credentials",
        emailEnv: "PILOT_EMAIL",
        passwordEnv: "PILOT_PASSWORD",
      },
      safety: {
        permittedRoutes: ["/login", "/dashboard"],
        prohibitedActions: [],
        allowProductionMutation: false,
        allowExternalSideEffects: false,
      },
      retention: { artifactDays: 1 },
    }),
    { mode: 0o600 },
  );
  const environment = getEnvironment({
    NODE_ENV: "test",
    QA_DATA_DIR: root,
    QA_DATABASE_PATH: join(root, "qa.db"),
    QA_ALLOWED_CONFIGURATION_ROOTS: root,
    QA_ALLOWED_TARGET_HOSTS: "127.0.0.1",
    QA_BROWSER_TIMEOUT_MS: "10000",
    QA_RUN_TIMEOUT_MS: "30000",
    QA_ACTION_RETRIES: "0",
  });
  const variables = {
    PILOT_BASE_URL: "http://127.0.0.1:3100",
    PILOT_EMAIL: "demo@example.test",
    PILOT_PASSWORD: "demo-password",
  };
  const store = new QaStore(environment.QA_DATABASE_PATH);
  const orchestrator = new QaOrchestrator(environment, store, variables);
  try {
    const request = orchestrator.createRequest({
      workflow: "MANUAL",
      applicationName: "Authenticated demo",
      baseUrl: variables.PILOT_BASE_URL,
      environment: "STAGING",
      objective: "Validate a protected route with server-side authentication",
      source: { schemaVersion: "repository-source/v1", mode: "NONE" },
      existingCasesText: "Page loads /dashboard.",
      configurationFile,
    });
    const plan = await orchestrator.createPlan(request.id);
    orchestrator.decidePlanItem(plan.id, "TEST-001", "approve");
    orchestrator.approvePlan(plan.id);
    const queued = orchestrator.startRun(plan.id);
    await expect
      .poll(() => store.get<QaRun>("runs", queued.id), { timeout: 30_000 })
      .toMatchObject({ status: "COMPLETED" });
    const result = store.get<QaRun>("runs", queued.id)!.results[0]!;
    expect(result.status).toBe("PASS");
    const sensitiveArtifacts = result.evidence.filter((item) =>
      ["SCREENSHOT", "TRACE"].includes(item.type),
    );
    expect(sensitiveArtifacts).toHaveLength(2);
    for (const artifact of sensitiveArtifacts) {
      expect(artifact.available).toBe(false);
      await expect(access(artifact.path)).rejects.toThrow();
    }
    const browserLog = result.evidence.find((item) => item.type === "BROWSER_LOG")!;
    expect(await readFile(browserLog.path, "utf8")).toMatch(/REDACTED/);
    expect(JSON.stringify(store.list("requests"))).not.toContain(variables.PILOT_PASSWORD);
  } finally {
    store.close();
  }
});

test("treats legacy authentication adapters as sensitive by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "qa-legacy-auth-e2e-"));
  const legacyAuthentication: AuthenticationAdapter = {
    name: "legacy-authentication-adapter",
    async contextOptions() {
      return {};
    },
  };
  const runner = new PlaywrightQaRunner({
    evidenceRoot: root,
    timeoutMs: 10_000,
    retries: 0,
    authentication: legacyAuthentication,
  });
  const item = testPlanItemSchema.parse({
    schemaVersion: "test-plan-item/v1",
    id: "TEST-001",
    source: "USER",
    title: "Login button is visible",
    category: "Authentication",
    route: "/login",
    steps: [
      {
        type: "assertElementVisible",
        strategy: "role",
        role: "button",
        name: "Login",
      },
    ],
    expectedResult: "The Login button is visible.",
    assertionType: "assertElementVisible",
  });

  const result = await runner.runCase({
    runId: "legacy-auth-run",
    item,
    baseUrl: "http://127.0.0.1:3100",
  });
  expect(result.status).toBe("PASS");
  const sensitiveArtifacts = result.evidence.filter((evidence) =>
    ["SCREENSHOT", "TRACE"].includes(evidence.type),
  );
  expect(sensitiveArtifacts).toHaveLength(2);
  for (const artifact of sensitiveArtifacts) {
    expect(artifact.available).toBe(false);
    await expect(access(artifact.path)).rejects.toThrow();
  }
});

test("blocks cross-origin navigation initiated by a click", async () => {
  const server = createServer((_request, response) => {
    response.setHeader("Content-Type", "text/html");
    response.end('<a href="https://example.com">Leave the target</a>');
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP test server");
  const root = await mkdtemp(join(tmpdir(), "qa-cross-origin-e2e-"));
  const runner = new PlaywrightQaRunner({
    evidenceRoot: root,
    timeoutMs: 10_000,
    retries: 0,
    authentication: {
      name: "sensitive-test-adapter",
      async contextOptions() {
        return {};
      },
    },
  });
  const item = testPlanItemSchema.parse({
    schemaVersion: "test-plan-item/v1",
    id: "TEST-001",
    source: "USER",
    title: "Cross-origin links remain blocked",
    category: "Navigation safety",
    route: "/",
    steps: [
      {
        type: "click",
        strategy: "role",
        role: "link",
        name: "Leave the target",
      },
    ],
    expectedResult: "Cross-origin navigation is blocked",
    assertionType: "navigation",
  });

  try {
    const result = await runner.runCase({
      runId: "cross-origin-run",
      item,
      baseUrl: `http://127.0.0.1:${address.port}`,
    });
    expect(result.status).toBe("FAIL");
    expect(result.actualResult).toMatch(/blocked|abort|navigation|closed/i);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("keeps numbered user cases separate from inferred validation warnings", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Existing cases or chat instructions")
    .fill(`Test the local demo login application.

1. The Login button is visible.
2. Empty email displays a required-field validation.
3. Invalid credentials display "Invalid credentials".
4. An unauthenticated visitor cannot access the dashboard.
5. Valid demo credentials open the dashboard.`);
  await page.getByRole("button", { name: /Create candidate plan/ }).click();

  await expect(page.locator(".case")).toHaveCount(5);
  await expect(page.locator(".case .source")).toHaveText(["USER", "USER", "USER", "USER", "USER"]);
  await expect(page.locator(".caseWarning")).not.toHaveCount(0);
});

test("reruns only failed cases and preserves failure evidence and lineage", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page
    .getByLabel("Existing cases or chat instructions")
    .fill("The Deliberately Missing button is visible.");
  await page.getByRole("button", { name: /Create candidate plan/ }).click();
  await page.getByRole("button", { name: "Approve case" }).click();
  await page.getByRole("button", { name: /Approve plan & queue run/ }).click();

  await expect(page.getByText("Run complete")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".resultStatus.FAIL")).toHaveText("FAIL");
  await page.getByRole("button", { name: "Rerun failures" }).click();
  await expect(page.getByText("Run complete")).toBeHidden();
  await expect(page.getByText("Run complete")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".resultStatus.FAIL")).toHaveText("FAIL");

  const historyResponse = await request.get("/api/internal/runs");
  const history = (await historyResponse.json()) as { data: QaRun[] };
  const failedRerun = history.data[0]!;
  expect(failedRerun.rerunMode).toBe("FAILURES");
  expect(failedRerun.results).toHaveLength(1);
  expect(failedRerun.results[0]?.actualResult).toMatch(/Deliberately Missing|locator/i);
  expect(failedRerun.results[0]?.evidence.map((item) => item.type)).toEqual(
    expect.arrayContaining(["SCREENSHOT", "TRACE", "BROWSER_LOG"]),
  );
  const browserLog = failedRerun.results[0]?.evidence.find((item) => item.type === "BROWSER_LOG");
  expect(browserLog?.available).toBe(true);
  expect(await readFile(browserLog!.path, "utf8")).not.toMatch(/Bearer\s+\S+|password\s*[:=]/i);

  await page.getByRole("button", { name: /Results & history/ }).click();
  await expect(page.getByRole("button", { name: /plan v1 · FAILURES/ }).first()).toBeVisible();
});

test("editing a case clears its approval before execution", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Existing cases or chat instructions").fill("The Login button is visible.");
  await page.getByRole("button", { name: /Create candidate plan/ }).click();
  await page.getByRole("button", { name: "Approve case" }).click();
  await expect(page.getByText("1 approved")).toBeVisible();

  await page.getByRole("button", { name: "Edit case" }).click();
  await page.getByLabel("Expected result").fill("The Login button remains visible");
  await page.getByRole("button", { name: "Save case" }).click();

  await expect(page.getByText("0 approved")).toBeVisible();
  await expect(page.getByText(/Approval gate · version 2/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Approve plan & queue run/ })).toBeDisabled();
});

test("cancels an in-flight assertion without reporting a pass", async ({ page }) => {
  await page.goto("/");
  await page
    .getByLabel("Existing cases or chat instructions")
    .fill("The Deliberately Missing button is visible.");
  await page.getByRole("button", { name: /Create candidate plan/ }).click();
  await page.getByRole("button", { name: "Approve case" }).click();
  await page.getByRole("button", { name: /Approve plan & queue run/ }).click();
  await expect(page.getByText(/Now running/)).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Cancel safely" }).click();

  await expect(page.getByText("CANCELLED", { exact: true })).toBeVisible({ timeout: 5_000 });
  await expect(page.locator(".resultStatus.PASS")).toHaveCount(0);
  await expect(page.locator(".resultStatus.NOT_EXECUTED")).toHaveText("NOT_EXECUTED");
});

test("marks a total run timeout as failed and never as pass", async () => {
  const root = await mkdtemp(join(tmpdir(), "qa-timeout-e2e-"));
  const environment = getEnvironment({
    NODE_ENV: "test",
    PORT: "3000",
    DEMO_TARGET_PORT: "3100",
    QA_DATA_DIR: root,
    QA_DATABASE_PATH: join(root, "qa.db"),
    QA_ALLOWED_REPOSITORY_ROOTS: root,
    QA_ALLOWED_TARGET_HOSTS: "localhost,127.0.0.1",
    QA_BROWSER_TIMEOUT_MS: "10000",
    QA_RUN_TIMEOUT_MS: "500",
    QA_ACTION_RETRIES: "3",
    GITHUB_CONNECTOR_ENABLED: "false",
    GITHUB_TOKEN: undefined,
    AI_TEST_PLANNING_ENABLED: "false",
    AI_PROVIDER: undefined,
    AI_MODEL: undefined,
    OPENAI_API_KEY: undefined,
  });
  const store = new QaStore(environment.QA_DATABASE_PATH);
  const orchestrator = new QaOrchestrator(environment, store);
  try {
    const request = orchestrator.createRequest({
      workflow: "MANUAL",
      applicationName: "Demo",
      baseUrl: "http://127.0.0.1:3100",
      environment: "LOCAL",
      objective: "Verify bounded timeout",
      source: { schemaVersion: "repository-source/v1", mode: "NONE" },
      existingCasesText: "The Deliberately Missing button is visible.",
    });
    const plan = await orchestrator.createPlan(request.id);
    orchestrator.decidePlanItem(plan.id, "TEST-001", "approve");
    orchestrator.approvePlan(plan.id);
    const queued = orchestrator.startRun(plan.id);
    await expect
      .poll(() => store.get<QaRun>("runs", queued.id), { timeout: 10_000 })
      .toMatchObject({ status: "FAILED", phase: "failed" });
    const timedOut = store.get<QaRun>("runs", queued.id)!;
    expect(timedOut.blockerMessage).toMatch(/configured 500 ms timeout/);
    expect(timedOut.results.every((result) => result.status !== "PASS")).toBe(true);
    expect(timedOut.results[0]?.retryCount).toBeLessThanOrEqual(3);
  } finally {
    store.close();
  }
});
