import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { QaOrchestrator } from "@qa/orchestrator";
import { QaStore } from "@qa/persistence";
import type { QaEnvironment } from "@qa/shared";

const stores: QaStore[] = [];

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "qa-orchestrator-"));
  const environment = {
    PORT: 3000,
    DEMO_TARGET_PORT: 3100,
    QA_DATA_DIR: root,
    QA_DATABASE_PATH: join(root, "qa.db"),
    QA_ALLOWED_REPOSITORY_ROOTS: [root],
    QA_ALLOWED_TARGET_HOSTS: ["localhost", "127.0.0.1"],
    QA_MAX_SCAN_FILES: 100,
    QA_MAX_SCAN_FILE_BYTES: 100_000,
    QA_MAX_CASES: 100,
    QA_BROWSER_TIMEOUT_MS: 1000,
    QA_RUN_TIMEOUT_MS: 5000,
    QA_ACTION_RETRIES: 0,
    GITHUB_CONNECTOR_ENABLED: false,
    GITHUB_TOKEN: undefined,
    AI_TEST_PLANNING_ENABLED: false,
    AI_PROVIDER: undefined,
    AI_MODEL: undefined,
    OPENAI_API_KEY: undefined,
    AI_REQUEST_TIMEOUT_MS: 1000,
    AI_MAX_INPUT_FILES: 10,
    AI_MAX_INPUT_BYTES: 1000,
    LOG_LEVEL: "silent",
  } satisfies QaEnvironment;
  const store = new QaStore(environment.QA_DATABASE_PATH);
  stores.push(store);
  return new QaOrchestrator(environment, store);
}

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

describe("orchestrator approval integration", () => {
  it("converts manual cases to a plan and refuses unapproved execution", async () => {
    const service = await setup();
    const request = service.createRequest({
      workflow: "MANUAL",
      applicationName: "Demo",
      baseUrl: "http://localhost:3100",
      environment: "LOCAL",
      objective: "Check Login",
      source: { schemaVersion: "repository-source/v1", mode: "NONE" },
      existingCasesText: "The Login button is visible.",
    });
    const plan = await service.createPlan(request.id);
    expect(plan.items).toHaveLength(1);
    expect(() => service.startRun(plan.id)).toThrow(/approval/);
    const individuallyApproved = service.decidePlanItem(plan.id, "TEST-001", "approve");
    const { approval } = service.approvePlan(individuallyApproved.id);
    expect(approval.approvedItemIds).toEqual(["TEST-001"]);
  });

  it("editing after approval invalidates exact-version execution", async () => {
    const service = await setup();
    const request = service.createRequest({
      workflow: "MANUAL",
      applicationName: "Demo",
      baseUrl: "http://localhost:3100",
      environment: "LOCAL",
      objective: "Check Login",
      source: { schemaVersion: "repository-source/v1", mode: "NONE" },
      existingCasesText: "The Login button is visible.",
    });
    const plan = await service.createPlan(request.id);
    service.decidePlanItem(plan.id, "TEST-001", "approve");
    service.approvePlan(plan.id);
    const edited = service.updatePlanItem(plan.id, "TEST-001", {
      expectedResult: "New exact result",
    });
    expect(edited.status).toBe("WAITING_FOR_APPROVAL");
    expect(() => service.startRun(plan.id)).toThrow(/exact-version/);
  });

  it("blocks prohibited side effects and requires explicit staging-data approval", async () => {
    const service = await setup();
    const request = service.createRequest({
      workflow: "MANUAL",
      applicationName: "Demo",
      baseUrl: "http://localhost:3100",
      environment: "STAGING",
      objective: "Check guarded mutations",
      source: { schemaVersion: "repository-source/v1", mode: "NONE" },
      existingCasesText: "The Login button is visible.",
    });
    const plan = await service.createPlan(request.id);
    service.updatePlanItem(plan.id, "TEST-001", {
      sideEffectLevel: "EXTERNAL_SIDE_EFFECT",
    });
    service.decidePlanItem(plan.id, "TEST-001", "approve");
    expect(() => service.approvePlan(plan.id)).toThrow(/prohibited side effects/);

    const staged = service.updatePlanItem(plan.id, "TEST-001", {
      sideEffectLevel: "STAGING_TEST_DATA",
    });
    service.decidePlanItem(staged.id, "TEST-001", "approve");
    expect(() => service.approvePlan(staged.id)).toThrow(/Additional staging approval/);
    expect(() => service.approvePlan(staged.id, ["TEST-001"])).not.toThrow();
  });
});
