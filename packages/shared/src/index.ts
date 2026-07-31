import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DEMO_TARGET_PORT: z.coerce.number().int().positive().default(3100),
  QA_DATA_DIR: z.string().default("./var"),
  QA_DATABASE_PATH: z.string().default("./var/qa-platform.db"),
  QA_ALLOWED_REPOSITORY_ROOTS: z.string().default(""),
  QA_ALLOWED_CONFIGURATION_ROOTS: z.string().default("./config/pilots"),
  QA_ALLOWED_TARGET_HOSTS: z.string().default("localhost,127.0.0.1"),
  QA_MAX_SCAN_FILES: z.coerce.number().int().positive().default(5000),
  QA_MAX_SCAN_FILE_BYTES: z.coerce.number().int().positive().default(524288),
  QA_MAX_CASES: z.coerce.number().int().positive().max(500).default(100),
  QA_BROWSER_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  QA_RUN_TIMEOUT_MS: z.coerce.number().int().positive().default(600_000),
  QA_ACTION_RETRIES: z.coerce.number().int().min(0).max(3).default(1),
  GITHUB_CONNECTOR_ENABLED: z.string().default("false"),
  GITHUB_TOKEN: z.string().optional(),
  AI_TEST_PLANNING_ENABLED: z.string().default("false"),
  AI_PROVIDER: z.string().optional(),
  AI_MODEL: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  AI_MAX_INPUT_FILES: z.coerce.number().int().positive().default(20),
  AI_MAX_INPUT_BYTES: z.coerce.number().int().positive().default(200_000),
  LOG_LEVEL: z.string().default("info"),
});

export type QaEnvironment = ReturnType<typeof getEnvironment>;

export function getEnvironment(input: NodeJS.ProcessEnv = process.env) {
  const parsed = envSchema.parse(input);
  return {
    ...parsed,
    QA_DATA_DIR: resolve(parsed.QA_DATA_DIR),
    QA_DATABASE_PATH: resolve(parsed.QA_DATABASE_PATH),
    QA_ALLOWED_REPOSITORY_ROOTS: parsed.QA_ALLOWED_REPOSITORY_ROOTS.split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => resolve(value)),
    QA_ALLOWED_CONFIGURATION_ROOTS: parsed.QA_ALLOWED_CONFIGURATION_ROOTS.split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => resolve(value)),
    QA_ALLOWED_TARGET_HOSTS: parsed.QA_ALLOWED_TARGET_HOSTS.split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
    GITHUB_CONNECTOR_ENABLED: parsed.GITHUB_CONNECTOR_ENABLED === "true",
    AI_TEST_PLANNING_ENABLED: parsed.AI_TEST_PLANNING_ENABLED === "true",
  };
}

export function createId(prefix: string) {
  return `${prefix}_${randomUUID()}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function exhaustive(value: never): never {
  throw new Error(`Unhandled value: ${String(value)}`);
}
