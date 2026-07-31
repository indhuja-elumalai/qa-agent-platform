import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createPilotAuthentication,
  loadPilotConfiguration,
  validatePlanItemAgainstPilot,
  validateRequestAgainstPilot,
} from "@qa/orchestrator";
import { testPlanItemSchema } from "@qa/schemas";

async function writeConfiguration(
  overrides: Record<string, unknown> = {},
): Promise<{ root: string; path: string }> {
  const root = await mkdtemp(join(tmpdir(), "qa-pilot-config-"));
  const path = join(root, "pilot.json");
  const configuration = {
    schemaVersion: "qa-pilot-configuration/v1",
    enabled: true,
    application: { name: "Pilot application" },
    environment: {
      kind: "STAGING",
      baseUrlEnv: "PILOT_BASE_URL",
      expectedHost: "staging.example.test",
    },
    source: { mode: "LOCAL", repositoryPathEnv: "PILOT_REPOSITORY_PATH" },
    auth: {
      adapter: "environment-credentials",
      emailEnv: "PILOT_LOGIN_EMAIL",
      passwordEnv: "PILOT_LOGIN_PASSWORD",
    },
    safety: {
      permittedRoutes: ["/login", "/safe"],
      prohibitedActions: ["selectOption"],
      allowProductionMutation: false,
      allowExternalSideEffects: false,
    },
    retention: { artifactDays: 14 },
    ...overrides,
  };
  await writeFile(path, JSON.stringify(configuration), { mode: 0o600 });
  return { root, path };
}

describe("pilot configuration", () => {
  it("resolves environment references and creates a sensitive authentication adapter", async () => {
    const { root, path } = await writeConfiguration();
    const variables = {
      PILOT_BASE_URL: "https://staging.example.test",
      PILOT_REPOSITORY_PATH: root,
      PILOT_LOGIN_EMAIL: "pilot@example.test",
      PILOT_LOGIN_PASSWORD: "not-persisted",
    };
    const pilot = loadPilotConfiguration(path, [root], variables);
    validateRequestAgainstPilot(
      {
        workflow: "REPOSITORY",
        applicationName: "Pilot application",
        baseUrl: variables.PILOT_BASE_URL,
        environment: "STAGING",
        objective: "Safe pilot",
        source: {
          schemaVersion: "repository-source/v1",
          mode: "LOCAL",
          localPath: root,
        },
        existingCasesText: "",
        configurationFile: path,
      },
      pilot,
    );
    const authentication = createPilotAuthentication(pilot, variables);
    expect(authentication.name).toBe("environment-credentials");
    expect(authentication.containsSensitiveState).toBe(true);
    expect(JSON.stringify(pilot)).not.toContain(variables.PILOT_LOGIN_PASSWORD);
  });

  it("rejects disabled profiles and plans outside the route/action policy", async () => {
    const disabled = await writeConfiguration({ enabled: false });
    expect(() =>
      loadPilotConfiguration(disabled.path, [disabled.root], {
        PILOT_BASE_URL: "https://staging.example.test",
        PILOT_REPOSITORY_PATH: disabled.root,
      }),
    ).toThrow(/disabled/);

    const { root, path } = await writeConfiguration();
    const pilot = loadPilotConfiguration(path, [root], {
      PILOT_BASE_URL: "https://staging.example.test",
      PILOT_REPOSITORY_PATH: root,
    });
    const item = testPlanItemSchema.parse({
      schemaVersion: "test-plan-item/v1",
      id: "TEST-001",
      source: "USER",
      title: "Disallowed route",
      category: "Safety",
      route: "/admin",
      steps: [{ type: "goto", path: "/admin" }],
      expectedResult: "Admin remains untouched",
      assertionType: "navigation",
    });
    expect(() => validatePlanItemAgainstPilot(item, pilot)).toThrow(/route outside/);
    expect(() =>
      validatePlanItemAgainstPilot(
        testPlanItemSchema.parse({
          ...item,
          route: "//outside.example/path",
          steps: [{ type: "goto", path: "//outside.example/path" }],
        }),
        pilot,
      ),
    ).toThrow(/route outside/);

    const prohibited = testPlanItemSchema.parse({
      ...item,
      title: "Disallowed action",
      route: "/safe",
      steps: [
        { type: "goto", path: "/safe" },
        {
          type: "selectOption",
          strategy: "label",
          name: "Role",
          option: "admin",
        },
      ],
    });
    expect(() => validatePlanItemAgainstPilot(prohibited, pilot)).toThrow(/prohibited action/);
  });

  it("requires credential login routes to be included in the pilot allowlist", async () => {
    const { root, path } = await writeConfiguration({
      safety: {
        permittedRoutes: ["/safe"],
        prohibitedActions: [],
        allowProductionMutation: false,
        allowExternalSideEffects: false,
      },
    });
    expect(() =>
      loadPilotConfiguration(path, [root], {
        PILOT_BASE_URL: "https://staging.example.test",
        PILOT_REPOSITORY_PATH: root,
      }),
    ).toThrow(/authentication login route.*outside.*allowlist/);
  });

  it("resolves approved storage state as sensitive server-side authentication", async () => {
    const { root, path } = await writeConfiguration({
      auth: {
        adapter: "playwright-storage-state",
        storageStateEnv: "PILOT_STORAGE_STATE",
      },
    });
    const storageState = join(root, "storage-state.json");
    await writeFile(storageState, JSON.stringify({ cookies: [], origins: [] }), { mode: 0o600 });
    const pilot = loadPilotConfiguration(path, [root], {
      PILOT_BASE_URL: "https://staging.example.test",
      PILOT_REPOSITORY_PATH: root,
    });
    const authentication = createPilotAuthentication(pilot, {
      PILOT_STORAGE_STATE: storageState,
    });
    expect(authentication.name).toBe("playwright-storage-state");
    expect(authentication.containsSensitiveState).toBe(true);
  });

  it("rejects profiles outside the configured root", async () => {
    const allowedRoot = await mkdtemp(join(tmpdir(), "qa-pilot-allowed-"));
    await mkdir(allowedRoot, { recursive: true });
    const outside = await writeConfiguration();
    expect(() => loadPilotConfiguration(outside.path, [allowedRoot], {})).toThrow(
      /outside configured roots/,
    );
  });
});
