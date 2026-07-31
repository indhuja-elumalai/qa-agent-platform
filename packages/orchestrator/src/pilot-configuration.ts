import { readFileSync, realpathSync, statSync } from "node:fs";
import { extname, relative, resolve, sep } from "node:path";
import type { QaRequest, TestPlanItem } from "@qa/schemas";
import { actionTypes } from "@qa/schemas";
import {
  EnvironmentCredentialsAuthenticationAdapter,
  NoAuthenticationAdapter,
  StorageStateAuthenticationAdapter,
  type AuthenticationAdapter,
} from "@qa/qa-runner";
import { isProductionUrl, SafetyError } from "@qa/security";
import { z } from "zod";

const environmentReference = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]*$/, "must be an uppercase environment variable name");

const authenticationSchema = z.discriminatedUnion("adapter", [
  z.object({ adapter: z.literal("none") }),
  z.object({
    adapter: z.literal("playwright-storage-state"),
    storageStateEnv: environmentReference,
  }),
  z.object({
    adapter: z.literal("environment-credentials"),
    emailEnv: environmentReference,
    passwordEnv: environmentReference,
    loginPath: z.string().startsWith("/").default("/login"),
    emailLabel: z.string().min(1).max(100).default("Email"),
    passwordLabel: z.string().min(1).max(100).default("Password"),
    submitName: z.string().min(1).max(100).default("Login"),
  }),
]);

export const pilotConfigurationSchema = z.object({
  schemaVersion: z.literal("qa-pilot-configuration/v1"),
  enabled: z.boolean(),
  application: z.object({ name: z.string().min(2).max(120) }),
  environment: z.object({
    kind: z.enum(["TEST", "STAGING"]),
    baseUrlEnv: environmentReference,
    expectedHost: z
      .string()
      .min(1)
      .transform((value) => value.toLowerCase()),
  }),
  source: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("NONE") }),
    z.object({ mode: z.literal("LOCAL"), repositoryPathEnv: environmentReference }),
  ]),
  auth: authenticationSchema,
  safety: z.object({
    permittedRoutes: z.array(z.string().startsWith("/")).min(1),
    prohibitedActions: z.array(z.enum(actionTypes)).default([]),
    allowProductionMutation: z.literal(false),
    allowExternalSideEffects: z.literal(false),
  }),
  retention: z.object({
    artifactDays: z.number().int().min(1).max(90),
  }),
});

export type PilotConfiguration = z.infer<typeof pilotConfigurationSchema>;

export interface ResolvedPilotConfiguration {
  path: string;
  configuration: PilotConfiguration;
  baseUrl: string;
  repositoryPath?: string;
}

export type EnvironmentValues = Record<string, string | undefined>;

function resolveAllowedFile(inputPath: string, roots: string[]) {
  if (roots.length === 0) {
    throw new SafetyError(
      "No pilot configuration root is configured",
      "CONFIGURATION_ROOT_NOT_CONFIGURED",
    );
  }
  const file = realpathSync(resolve(inputPath));
  if (!statSync(file).isFile() || extname(file).toLowerCase() !== ".json") {
    throw new SafetyError("Pilot configuration must be a JSON file", "INVALID_CONFIGURATION_FILE");
  }
  const allowed = roots.some((configuredRoot) => {
    const root = realpathSync(configuredRoot);
    const child = relative(root, file);
    return child === "" || (!child.startsWith(`..${sep}`) && child !== "..");
  });
  if (!allowed) {
    throw new SafetyError(
      "Pilot configuration is outside configured roots",
      "CONFIGURATION_PATH_DENIED",
    );
  }
  return file;
}

function requireEnvironmentValue(name: string, variables: EnvironmentValues) {
  const value = variables[name];
  if (value === undefined || value.length === 0) {
    throw new SafetyError(
      `Required pilot environment variable ${name} is not configured`,
      "PILOT_ENVIRONMENT_MISSING",
    );
  }
  return value;
}

export function loadPilotConfiguration(
  inputPath: string,
  roots: string[],
  variables: EnvironmentValues,
): ResolvedPilotConfiguration {
  const path = resolveAllowedFile(inputPath, roots);
  const configuration = pilotConfigurationSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  if (!configuration.enabled) {
    throw new SafetyError("Pilot configuration is disabled", "PILOT_DISABLED");
  }
  if (
    configuration.auth.adapter === "environment-credentials" &&
    !routePermitted(configuration.auth.loginPath, configuration.safety.permittedRoutes)
  ) {
    throw new SafetyError(
      "Pilot authentication login route is outside the pilot allowlist",
      "PILOT_ROUTE_DENIED",
    );
  }
  const baseUrl = requireEnvironmentValue(configuration.environment.baseUrlEnv, variables);
  const url = new URL(baseUrl);
  if (url.hostname.toLowerCase() !== configuration.environment.expectedHost) {
    throw new SafetyError(
      "Pilot target host does not match the configured identity",
      "PILOT_HOST_MISMATCH",
    );
  }
  if (isProductionUrl(baseUrl)) {
    throw new SafetyError("Pilot configuration cannot target production", "PRODUCTION_DENIED");
  }
  const repositoryPath =
    configuration.source.mode === "LOCAL"
      ? realpathSync(requireEnvironmentValue(configuration.source.repositoryPathEnv, variables))
      : undefined;
  if (repositoryPath && !statSync(repositoryPath).isDirectory()) {
    throw new SafetyError("Pilot repository path must be a directory", "INVALID_REPOSITORY_PATH");
  }
  return { path, configuration, baseUrl: url.toString(), repositoryPath };
}

function sameUrl(left: string, right: string) {
  return new URL(left).toString() === new URL(right).toString();
}

export function validateRequestAgainstPilot(
  request: Omit<QaRequest, "schemaVersion" | "id" | "createdAt"> | QaRequest,
  pilot: ResolvedPilotConfiguration,
) {
  const config = pilot.configuration;
  if (request.applicationName !== config.application.name) {
    throw new SafetyError(
      "Request application does not match the pilot identity",
      "PILOT_APPLICATION_MISMATCH",
    );
  }
  if (request.environment !== config.environment.kind || !sameUrl(request.baseUrl, pilot.baseUrl)) {
    throw new SafetyError(
      "Request target does not match the pilot environment",
      "PILOT_TARGET_MISMATCH",
    );
  }
  if (config.source.mode === "LOCAL") {
    if (
      request.source.mode !== "LOCAL" ||
      realpathSync(request.source.localPath) !== pilot.repositoryPath
    ) {
      throw new SafetyError(
        "Request repository does not match the pilot configuration",
        "PILOT_REPOSITORY_MISMATCH",
      );
    }
  } else if (request.source.mode !== "NONE") {
    throw new SafetyError(
      "Pilot configuration does not permit a repository source",
      "PILOT_REPOSITORY_DENIED",
    );
  }
}

function routePermitted(route: string, prefixes: string[]) {
  const parsed = new URL(route, "https://pilot.invalid");
  if (parsed.origin !== "https://pilot.invalid") return false;
  const path = parsed.pathname;
  return prefixes.some(
    (prefix) =>
      prefix === "/" || path === prefix || path.startsWith(`${prefix.replace(/\/$/, "")}/`),
  );
}

export function validatePlanItemAgainstPilot(
  item: TestPlanItem,
  pilot: ResolvedPilotConfiguration,
) {
  const { permittedRoutes, prohibitedActions } = pilot.configuration.safety;
  const routes = [
    item.route,
    ...item.steps.filter((step) => step.type === "goto").map((step) => step.path ?? "/"),
  ];
  if (routes.some((route) => !routePermitted(route, permittedRoutes))) {
    throw new SafetyError(
      `Plan item ${item.id} uses a route outside the pilot allowlist`,
      "PILOT_ROUTE_DENIED",
    );
  }
  if (item.steps.some((step) => prohibitedActions.includes(step.type))) {
    throw new SafetyError(`Plan item ${item.id} uses a prohibited action`, "PILOT_ACTION_DENIED");
  }
}

export function createPilotAuthentication(
  pilot: ResolvedPilotConfiguration,
  variables: EnvironmentValues,
): AuthenticationAdapter {
  const auth = pilot.configuration.auth;
  if (auth.adapter === "none") return new NoAuthenticationAdapter();
  if (auth.adapter === "playwright-storage-state") {
    const path = realpathSync(requireEnvironmentValue(auth.storageStateEnv, variables));
    if (!statSync(path).isFile()) {
      throw new SafetyError("Storage state must be a file", "INVALID_STORAGE_STATE");
    }
    return new StorageStateAuthenticationAdapter(path);
  }
  return new EnvironmentCredentialsAuthenticationAdapter({
    email: requireEnvironmentValue(auth.emailEnv, variables),
    password: requireEnvironmentValue(auth.passwordEnv, variables),
    loginPath: auth.loginPath,
    emailLabel: auth.emailLabel,
    passwordLabel: auth.passwordLabel,
    submitName: auth.submitName,
  });
}
