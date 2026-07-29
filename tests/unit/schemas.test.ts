import { describe, expect, it } from "vitest";
import { actionSchema, qaRequestSchema, testPlanItemSchema } from "@qa/schemas";

describe("versioned schemas", () => {
  it("rejects unsupported request versions", () => {
    expect(() =>
      qaRequestSchema.parse({
        schemaVersion: "qa-request/v2",
        id: "request",
        workflow: "MANUAL",
        applicationName: "Demo",
        baseUrl: "http://localhost:3100",
        environment: "LOCAL",
        objective: "Check login",
        source: { schemaVersion: "repository-source/v1", mode: "NONE" },
        existingCasesText: "",
        createdAt: new Date().toISOString(),
      }),
    ).toThrow();
  });

  it("rejects arbitrary actions and incomplete selectors", () => {
    expect(() => actionSchema.parse({ type: "evaluate", value: "document.cookie" })).toThrow();
    expect(() => actionSchema.parse({ type: "click", name: "Login" })).toThrow(/selector strategy/);
    expect(() => actionSchema.parse({ type: "press" })).toThrow(/allowlisted key/);
    expect(() => actionSchema.parse({ type: "assertUrlContains" })).toThrow(/expected value/);
  });

  it("requires mode-specific repository source fields", () => {
    expect(() =>
      qaRequestSchema.parse({
        schemaVersion: "qa-request/v1",
        id: "request",
        workflow: "REPOSITORY",
        applicationName: "Demo",
        baseUrl: "http://localhost:3100",
        environment: "LOCAL",
        objective: "Check login",
        source: { schemaVersion: "repository-source/v1", mode: "LOCAL" },
        existingCasesText: "",
        createdAt: new Date().toISOString(),
      }),
    ).toThrow();
    expect(() =>
      qaRequestSchema.parse({
        schemaVersion: "qa-request/v1",
        id: "request",
        workflow: "REPOSITORY",
        applicationName: "Demo",
        baseUrl: "http://localhost:3100",
        environment: "LOCAL",
        objective: "Check login",
        source: {
          schemaVersion: "repository-source/v1",
          mode: "LOCAL",
          localPath: "/approved/repository",
          comparisonRef: "--output=/tmp/not-read-only",
        },
        existingCasesText: "",
        createdAt: new Date().toISOString(),
      }),
    ).toThrow(/Git ref/);
  });

  it("requires stable test IDs", () => {
    expect(() =>
      testPlanItemSchema.parse({
        schemaVersion: "test-plan-item/v1",
        id: "login-test",
        source: "USER",
        title: "Login works",
        category: "Authentication",
        steps: [{ type: "goto", path: "/" }],
        expectedResult: "Login works",
        assertionType: "navigation",
      }),
    ).toThrow();
  });
});
