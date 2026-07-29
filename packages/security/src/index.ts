import { realpath, stat } from "node:fs/promises";
import { basename, extname, relative, resolve, sep } from "node:path";

const sensitiveKey = /(password|passwd|secret|token|api[-_]?key|authorization|cookie|otp|email)/i;
const productionHost = /(^|[.-])(prod|production)([.-]|$)/i;
const forbiddenSegments = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
  "build",
  "coverage",
  "vendor",
  ".env",
  ".cache",
  "out",
]);
const textExtensions = new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".json",
  ".md",
  ".css",
  ".scss",
  ".html",
  ".yaml",
  ".yml",
  ".toml",
  ".txt",
  ".mjs",
  ".cjs",
  ".vue",
  ".svelte",
]);

export class SafetyError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "SafetyError";
  }
}

export function isProductionUrl(input: string) {
  const url = new URL(input);
  return productionHost.test(url.hostname) || url.hostname.startsWith("www.");
}

export function validateTargetUrl(
  input: string,
  allowedHosts: string[],
  options: { allowProduction?: boolean } = {},
) {
  const url = new URL(input);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new SafetyError("Only HTTP(S) targets are supported", "UNSUPPORTED_PROTOCOL");
  }
  if (!allowedHosts.includes(url.hostname.toLowerCase())) {
    throw new SafetyError(`Target host ${url.hostname} is not allowlisted`, "HOST_NOT_ALLOWED");
  }
  if (isProductionUrl(input) && !options.allowProduction) {
    throw new SafetyError("Production targets are denied by default", "PRODUCTION_DENIED");
  }
  url.username = "";
  url.password = "";
  url.hash = "";
  return url;
}

export function enforceSameBaseHost(baseUrl: string, destination: string) {
  const base = new URL(baseUrl);
  const target = new URL(destination, base);
  if (target.origin !== base.origin) {
    throw new SafetyError("Cross-origin navigation is blocked", "CROSS_ORIGIN_NAVIGATION");
  }
  return target;
}

export async function resolveAllowedRepositoryPath(inputPath: string, roots: string[]) {
  if (!inputPath || roots.length === 0) {
    throw new SafetyError("No repository root is configured", "REPOSITORY_ROOT_NOT_CONFIGURED");
  }
  const resolvedInput = await realpath(resolve(inputPath));
  const info = await stat(resolvedInput);
  if (!info.isDirectory()) {
    throw new SafetyError("Repository path must be a directory", "INVALID_REPOSITORY_PATH");
  }
  for (const configuredRoot of roots) {
    const root = await realpath(configuredRoot);
    const child = relative(root, resolvedInput);
    if (child === "" || (!child.startsWith(`..${sep}`) && child !== "..")) {
      return resolvedInput;
    }
  }
  throw new SafetyError("Repository path is outside configured roots", "REPOSITORY_PATH_DENIED");
}

export function shouldInspectPath(filePath: string) {
  const segments = filePath.split(/[\\/]/);
  if (segments.some((segment) => forbiddenSegments.has(segment))) return false;
  const name = basename(filePath);
  if (/^\.env($|\.)/i.test(name) || /\.(pem|key|p12|crt|sqlite|db)$/i.test(name)) return false;
  return textExtensions.has(extname(filePath).toLowerCase()) || name === "package.json";
}

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        sensitiveKey.test(key) ? "[REDACTED]" : redact(item),
      ]),
    );
  }
  if (typeof value !== "string") return value;
  return value
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+/gi, "$1[REDACTED]")
    .replace(/([?&](?:token|key|secret|password|email)=)[^&]*/gi, "$1[REDACTED]")
    .replace(
      /\b(password|passwd|secret|token|api[-_ ]?key|authorization|cookie|otp|email)(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&]+)/gi,
      "$1$2[REDACTED]",
    )
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]")
    .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]{8,})\b/gi, "[REDACTED]");
}

export function redactUrl(input: string) {
  const url = new URL(input);
  url.username = "";
  url.password = "";
  for (const key of [...url.searchParams.keys()]) {
    if (sensitiveKey.test(key)) url.searchParams.set(key, "[REDACTED]");
  }
  return url.toString();
}

export function safeFilename(input: string) {
  const safe = input
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 120);
  return safe || "artifact";
}
