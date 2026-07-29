import { createHash } from "node:crypto";
import type { RepositoryAnalysis, RepositorySource } from "@qa/schemas";
import { redact } from "@qa/security";
import { createId, nowIso } from "@qa/shared";
import type { RepositoryConnector, RepositoryFile } from "@qa/repository-connectors";

function lineFor(content: string, pattern: RegExp) {
  const lines = content.split("\n");
  const index = lines.findIndex((line) => pattern.test(line));
  return index >= 0 ? index + 1 : undefined;
}

function references(
  files: RepositoryFile[],
  predicate: (file: RepositoryFile) => boolean,
  reason: string,
) {
  return files.filter(predicate).map((file) => ({ path: file.path, line: 1, reason }));
}

export async function analyzeRepository(input: {
  requestId: string;
  source: RepositorySource;
  connector: RepositoryConnector;
}): Promise<RepositoryAnalysis> {
  const snapshot = await input.connector.inspect(input.source);
  const packageFile = snapshot.files.find((file) => file.path === "package.json");
  let packageJson: {
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  } = {};
  if (packageFile) {
    try {
      packageJson = JSON.parse(packageFile.content);
    } catch {
      snapshot.warnings.push("package.json could not be parsed");
    }
  }
  const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
  const frameworks = [
    dependencies.next && "Next.js",
    dependencies.react && "React",
    dependencies.vue && "Vue",
    dependencies.svelte && "Svelte",
  ].filter((value): value is string => Boolean(value));
  const filePaths = snapshot.files.map((file) => file.path);
  const packageManager = filePaths.includes("pnpm-lock.yaml")
    ? "pnpm"
    : filePaths.includes("yarn.lock")
      ? "yarn"
      : filePaths.includes("package-lock.json")
        ? "npm"
        : "unknown";
  const routeFiles = snapshot.files.filter((file) =>
    /(^|\/)(app|pages|routes)\/.*(page|route|index)?\.(tsx?|jsx?)$/.test(file.path),
  );
  const components = snapshot.files.filter((file) =>
    /(^|\/)components\/.*\.(tsx?|jsx?)$/.test(file.path),
  );
  const testFiles = snapshot.files.filter((file) =>
    /(\.(test|spec)\.(tsx?|jsx?)$|(^|\/)(e2e|tests?|__tests__)\/)/.test(file.path),
  );
  const risks: string[] = [];
  if (snapshot.changedFiles.some((path) => /auth|login|session/i.test(path)))
    risks.push("Authentication or session behavior changed");
  if (snapshot.changedFiles.some((path) => /route|page|navigation/i.test(path)))
    risks.push("Routing or navigation behavior changed");
  if (snapshot.changedFiles.some((path) => /form|input|validation/i.test(path)))
    risks.push("Form input or validation behavior changed");
  if (routeFiles.length > 0 && testFiles.length === 0)
    risks.push("Routes were discovered without frontend test files");
  const evidence = [
    ...references(snapshot.files, (file) => file.path === "package.json", "Package metadata"),
    ...snapshot.changedFiles.slice(0, 50).map((path) => ({ path, reason: "Changed file" })),
  ];
  const cacheHash = createHash("sha256").update(
    `${snapshot.root ?? snapshot.identity}:${input.source.ref ?? ""}:${snapshot.commitSha ?? "working-tree"}:${snapshot.hasUncommittedChanges}`,
  );
  for (const file of [...snapshot.files].sort((left, right) =>
    left.path.localeCompare(right.path),
  )) {
    cacheHash.update("\0").update(file.path).update("\0").update(file.content);
  }
  const cacheKey = cacheHash.digest("hex");
  return {
    schemaVersion: "repository-analysis/v1",
    id: createId("scan"),
    requestId: input.requestId,
    status: "COMPLETED",
    connectorType: input.source.mode === "GITHUB" ? "GITHUB" : "LOCAL",
    repositoryIdentity: snapshot.identity,
    displayPath: snapshot.root ? snapshot.identity : undefined,
    branch: snapshot.branch,
    ref: input.source.ref,
    commitSha: snapshot.commitSha,
    packageManager,
    frameworks,
    scripts: redact(packageJson.scripts ?? {}) as Record<string, string>,
    routes: routeFiles.map((file) => ({
      path: file.path,
      line: lineFor(file.content, /export\s+default|function|class/),
      reason: "Frontend route",
    })),
    components: components.map((file) => ({
      path: file.path,
      line: lineFor(file.content, /export|function|class/),
      reason: "Frontend component",
    })),
    changedFiles: snapshot.changedFiles,
    hasUncommittedChanges: snapshot.hasUncommittedChanges,
    existingTests: testFiles.map((file) => ({ path: file.path, line: 1, reason: "Existing test" })),
    riskAreas: risks,
    warnings: snapshot.warnings,
    evidence,
    cacheKey,
    scannedAt: nowIso(),
  };
}
