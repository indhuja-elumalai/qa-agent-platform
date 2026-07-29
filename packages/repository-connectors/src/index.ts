import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";
import { promisify } from "node:util";
import type { RepositorySource } from "@qa/schemas";
import { resolveAllowedRepositoryPath, shouldInspectPath } from "@qa/security";

const execFileAsync = promisify(execFile);

export interface RepositoryFile {
  path: string;
  size: number;
  content: string;
}

export interface RepositorySnapshot {
  identity: string;
  root?: string;
  branch?: string;
  commitSha?: string;
  changedFiles: string[];
  hasUncommittedChanges: boolean;
  files: RepositoryFile[];
  warnings: string[];
}

export interface RepositoryConnector {
  inspect(source: RepositorySource): Promise<RepositorySnapshot>;
}

async function safeGit(root: string, args: string[]) {
  try {
    const { stdout } = await execFileAsync("git", ["-C", root, ...args], {
      timeout: 10_000,
      maxBuffer: 2_000_000,
      windowsHide: true,
    });
    return stdout.trimEnd();
  } catch {
    return "";
  }
}

export class LocalRepositoryConnector implements RepositoryConnector {
  constructor(
    private readonly options: {
      allowedRoots: string[];
      maxFiles: number;
      maxFileBytes: number;
    },
  ) {}

  async inspect(source: RepositorySource): Promise<RepositorySnapshot> {
    if (source.mode !== "LOCAL" || !source.localPath)
      throw new Error("Local repository path is required");
    const root = await resolveAllowedRepositoryPath(source.localPath, this.options.allowedRoots);
    const files: RepositoryFile[] = [];
    const warnings: string[] = [];
    let visited = 0;

    const walk = async (directory: string): Promise<void> => {
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        if (visited >= this.options.maxFiles) {
          warnings.push(`Scan stopped at the configured ${this.options.maxFiles} file limit`);
          return;
        }
        const absolute = resolve(directory, entry.name);
        const path = relative(root, absolute);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          if (shouldInspectPath(`${path}/placeholder.ts`)) await walk(absolute);
          continue;
        }
        visited += 1;
        if (!shouldInspectPath(path)) continue;
        const info = await stat(absolute);
        if (info.size > this.options.maxFileBytes) {
          warnings.push(`Skipped oversized text file: ${path}`);
          continue;
        }
        const buffer = await readFile(absolute);
        if (buffer.includes(0)) continue;
        files.push({ path, size: info.size, content: buffer.toString("utf8") });
      }
    };

    await walk(root);
    const [branch, commitSha, statusText, comparisonText] = await Promise.all([
      safeGit(root, ["branch", "--show-current"]),
      safeGit(root, ["rev-parse", "HEAD"]),
      safeGit(root, ["status", "--porcelain"]),
      source.comparisonRef
        ? safeGit(root, ["diff", "--name-only", `${source.comparisonRef}...HEAD`, "--"])
        : Promise.resolve(""),
    ]);

    return {
      identity: basename(root) || "local-repository",
      root,
      branch: branch || undefined,
      commitSha: commitSha || undefined,
      changedFiles: comparisonText
        ? comparisonText.split("\n").filter(Boolean)
        : statusText
            .split("\n")
            .filter(Boolean)
            .map((line) => line.slice(3)),
      hasUncommittedChanges: Boolean(statusText),
      files,
      warnings,
    };
  }
}

export class GitHubRepositoryConnector implements RepositoryConnector {
  constructor(private readonly options: { enabled: boolean; token?: string }) {}

  async inspect(source: RepositorySource): Promise<RepositorySnapshot> {
    if (source.mode !== "GITHUB" || !source.githubRepository) {
      throw new Error("GitHub owner/repository is required");
    }
    if (!this.options.enabled || !this.options.token) {
      const error = new Error("GitHub read-only connector is not configured");
      error.name = "GitHubConnectorBlocked";
      throw error;
    }
    const headers = {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${this.options.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    };
    const base = `https://api.github.com/repos/${source.githubRepository}`;
    const ref = source.ref || "HEAD";
    const metadataResponse = await fetch(`${base}/commits/${encodeURIComponent(ref)}`, {
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    if (!metadataResponse.ok)
      throw new Error(`GitHub metadata request failed (${metadataResponse.status})`);
    const metadata = (await metadataResponse.json()) as { sha: string };
    let changedFiles: string[] = [];
    if (source.pullRequestNumber) {
      const response = await fetch(`${base}/pulls/${source.pullRequestNumber}/files?per_page=100`, {
        headers,
        signal: AbortSignal.timeout(15_000),
      });
      if (response.ok) {
        changedFiles = ((await response.json()) as Array<{ filename: string }>).map(
          (file) => file.filename,
        );
      }
    }
    const treeResponse = await fetch(`${base}/git/trees/${metadata.sha}?recursive=1`, {
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    const tree = treeResponse.ok
      ? (
          (await treeResponse.json()) as {
            tree: Array<{ path: string; size?: number; type: string }>;
          }
        ).tree
      : [];
    const changedFileSet = new Set(changedFiles);
    const selectedPaths = tree
      .filter(
        (entry) =>
          entry.type === "blob" && shouldInspectPath(entry.path) && (entry.size ?? 0) < 524_288,
      )
      .sort((a, b) => Number(changedFileSet.has(b.path)) - Number(changedFileSet.has(a.path)))
      .slice(0, 50);
    const files: RepositoryFile[] = [];
    for (let index = 0; index < selectedPaths.length; index += 8) {
      const results = await Promise.all(
        selectedPaths.slice(index, index + 8).map(async (entry) => {
          const response = await fetch(
            `${base}/contents/${encodeURIComponent(entry.path)}?ref=${metadata.sha}`,
            {
              headers: { ...headers, Accept: "application/vnd.github.raw+json" },
              signal: AbortSignal.timeout(15_000),
            },
          );
          return response.ok
            ? { path: entry.path, size: entry.size ?? 0, content: await response.text() }
            : undefined;
        }),
      );
      files.push(...results.filter((result): result is RepositoryFile => Boolean(result)));
    }
    return {
      identity: source.githubRepository,
      branch: source.ref,
      commitSha: metadata.sha,
      changedFiles,
      hasUncommittedChanges: false,
      files,
      warnings: [],
    };
  }
}
