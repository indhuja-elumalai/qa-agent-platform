import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { EvidenceItem } from "@qa/schemas";
import { safeFilename } from "@qa/security";
import { createId, nowIso } from "@qa/shared";

export class EvidenceStore {
  constructor(private readonly root: string) {}

  runDirectory(runId: string) {
    return resolve(this.root, safeFilename(runId));
  }

  async ensureRun(runId: string) {
    const path = this.runDirectory(runId);
    await mkdir(path, { recursive: true });
    return path;
  }

  async writeText(input: {
    runId: string;
    testId?: string;
    type: EvidenceItem["type"];
    filename: string;
    content: string;
    mimeType?: string;
    description: string;
  }): Promise<EvidenceItem> {
    const directory = await this.ensureRun(input.runId);
    const path = join(directory, safeFilename(input.filename));
    await writeFile(path, input.content, { encoding: "utf8", mode: 0o600 });
    return {
      schemaVersion: "evidence-item/v1",
      id: createId("evidence"),
      runId: input.runId,
      testId: input.testId,
      type: input.type,
      path,
      mimeType: input.mimeType ?? "text/plain",
      description: input.description,
      available: true,
      createdAt: nowIso(),
    };
  }
}
