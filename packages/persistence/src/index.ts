import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  AuditEvent,
  PlanApproval,
  QaRequest,
  QaRun,
  RepositoryAnalysis,
  TestPlan,
} from "@qa/schemas";
import { nowIso } from "@qa/shared";

interface EntityByTable {
  requests: QaRequest;
  scans: RepositoryAnalysis;
  plans: TestPlan;
  approvals: PlanApproval;
  runs: QaRun;
  audit_events: AuditEvent;
}
type EntityTable = keyof EntityByTable;
type PersistedMetadata = {
  id: string;
  requestId?: string;
  cacheKey?: string;
  status?: string;
  version?: number;
  createdAt: string;
  updatedAt?: string;
};

const migrations = [
  `
  CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, request_id TEXT, cache_key TEXT, status TEXT, json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS scans (id TEXT PRIMARY KEY, request_id TEXT, cache_key TEXT, status TEXT, json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS plans (id TEXT NOT NULL, request_id TEXT, cache_key TEXT, status TEXT, version INTEGER NOT NULL, json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (id, version));
  CREATE TABLE IF NOT EXISTS approvals (id TEXT PRIMARY KEY, request_id TEXT, cache_key TEXT, status TEXT, json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, request_id TEXT, cache_key TEXT, status TEXT, json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS audit_events (id TEXT PRIMARY KEY, request_id TEXT, cache_key TEXT, status TEXT, json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_scans_cache_key ON scans(cache_key);
  CREATE INDEX IF NOT EXISTS idx_runs_created_at ON runs(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_plans_request ON plans(request_id, version DESC);
  `,
];

export class QaStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    for (const migration of migrations) this.db.exec(migration);
  }

  close() {
    this.db.close();
  }

  put<T extends EntityTable>(table: T, entity: EntityByTable[T]) {
    const value = entity as EntityByTable[T] & PersistedMetadata;
    const now = value.updatedAt ?? value.createdAt ?? nowIso();
    const version = table === "plans" ? value.version : undefined;
    if (table === "plans") {
      this.db
        .prepare(
          `INSERT OR REPLACE INTO plans (id, request_id, cache_key, status, version, json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          value.id,
          value.requestId ?? null,
          value.cacheKey ?? null,
          value.status ?? null,
          version ?? 1,
          JSON.stringify(entity),
          value.createdAt ?? now,
          now,
        );
      return entity;
    }
    this.db
      .prepare(
        `INSERT OR REPLACE INTO ${table} (id, request_id, cache_key, status, json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        value.id,
        value.requestId ?? null,
        value.cacheKey ?? null,
        value.status ?? null,
        JSON.stringify(entity),
        value.createdAt ?? now,
        now,
      );
    return entity;
  }

  get<T>(table: EntityTable, id: string, version?: number): T | undefined {
    const row =
      table === "plans" && version
        ? (this.db
            .prepare("SELECT json FROM plans WHERE id = ? AND version = ?")
            .get(id, version) as { json: string } | undefined)
        : (this.db
            .prepare(
              `SELECT json FROM ${table} WHERE id = ? ORDER BY ${table === "plans" ? "version" : "updated_at"} DESC LIMIT 1`,
            )
            .get(id) as { json: string } | undefined);
    return row ? (JSON.parse(row.json) as T) : undefined;
  }

  list<T>(table: EntityTable, limit = 100): T[] {
    const rows = this.db
      .prepare(`SELECT json FROM ${table} ORDER BY updated_at DESC LIMIT ?`)
      .all(limit) as Array<{ json: string }>;
    return rows.map((row) => JSON.parse(row.json) as T);
  }

  latestPlanForRequest(requestId: string): TestPlan | undefined {
    const row = this.db
      .prepare("SELECT json FROM plans WHERE request_id = ? ORDER BY version DESC LIMIT 1")
      .get(requestId) as { json: string } | undefined;
    return row ? (JSON.parse(row.json) as TestPlan) : undefined;
  }

  scanByCacheKey(cacheKey: string): RepositoryAnalysis | undefined {
    const row = this.db
      .prepare(
        "SELECT json FROM scans WHERE cache_key = ? AND status = 'COMPLETED' ORDER BY updated_at DESC LIMIT 1",
      )
      .get(cacheKey) as { json: string } | undefined;
    return row ? (JSON.parse(row.json) as RepositoryAnalysis) : undefined;
  }

  latestScanForRequest(requestId: string): RepositoryAnalysis | undefined {
    const row = this.db
      .prepare("SELECT json FROM scans WHERE request_id = ? ORDER BY updated_at DESC LIMIT 1")
      .get(requestId) as { json: string } | undefined;
    return row ? (JSON.parse(row.json) as RepositoryAnalysis) : undefined;
  }

  approvalForPlan(planId: string, version: number): PlanApproval | undefined {
    const row = this.db
      .prepare(
        `SELECT json FROM approvals
         WHERE json_extract(json, '$.planId') = ? AND json_extract(json, '$.planVersion') = ?
         LIMIT 1`,
      )
      .get(planId, version) as { json: string } | undefined;
    return row ? (JSON.parse(row.json) as PlanApproval) : undefined;
  }
}

export function initializeDatabase(path: string) {
  const store = new QaStore(path);
  store.close();
}
