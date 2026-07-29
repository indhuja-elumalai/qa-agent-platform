import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  enforceSameBaseHost,
  isProductionUrl,
  redact,
  resolveAllowedRepositoryPath,
  safeFilename,
  validateTargetUrl,
} from "@qa/security";

describe("security boundaries", () => {
  it("detects and denies production and non-allowlisted targets", () => {
    expect(isProductionUrl("https://app.production.example.com")).toBe(true);
    expect(() => validateTargetUrl("https://prod.example.com", ["prod.example.com"])).toThrow(
      /Production/,
    );
    expect(() => validateTargetUrl("http://evil.example", ["localhost"])).toThrow(/allowlisted/);
  });

  it("blocks cross-host navigation", () => {
    expect(() => enforceSameBaseHost("http://localhost:3100", "http://example.com")).toThrow(
      /Cross-origin/,
    );
    expect(enforceSameBaseHost("http://localhost:3100", "/login").pathname).toBe("/login");
  });

  it("restricts canonical repository paths and symlinks", async () => {
    const root = await mkdtemp(join(tmpdir(), "qa-root-"));
    const allowed = join(root, "allowed");
    const outside = join(root, "outside");
    await mkdir(allowed);
    await mkdir(outside);
    await writeFile(join(outside, "secret.txt"), "no");
    await symlink(outside, join(allowed, "escape"));
    await expect(resolveAllowedRepositoryPath(outside, [allowed])).rejects.toThrow(
      /outside configured roots/,
    );
    await expect(
      resolveAllowedRepositoryPath(join(allowed, "escape"), [allowed]),
    ).rejects.toThrow();
  });

  it("redacts secrets and creates safe filenames", () => {
    expect(redact({ password: "demo", nested: { token: "abc" }, value: "Bearer secret" })).toEqual({
      password: "[REDACTED]",
      nested: { token: "[REDACTED]" },
      value: "Bearer [REDACTED]",
    });
    expect(
      redact("email=person@example.test password: demo-password api_key=sk-example-secret"),
    ).not.toMatch(/person@example\.test|demo-password|sk-example-secret/);
    expect(safeFilename("../../bad report?.json")).toBe("bad-report-.json");
  });
});
