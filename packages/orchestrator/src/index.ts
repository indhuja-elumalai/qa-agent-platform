import type {
  AuditEvent,
  PlanApproval,
  QaRequest,
  QaRun,
  TestPlan,
  TestPlanItem,
} from "@qa/schemas";
import { planApprovalSchema, qaRequestSchema, qaRunSchema, testPlanSchema } from "@qa/schemas";
import { createReport, writeReports } from "@qa/reporting";
import { analyzeRepository } from "@qa/repository-analysis";
import { GitHubRepositoryConnector, LocalRepositoryConnector } from "@qa/repository-connectors";
import { PlaywrightQaRunner, type RunnerEvent } from "@qa/qa-runner";
import { QaStore } from "@qa/persistence";
import { redact, validateTargetUrl } from "@qa/security";
import { createId, getEnvironment, nowIso, type QaEnvironment } from "@qa/shared";
import { createCandidatePlan, createPlanningAdapter, editPlanItem } from "@qa/test-planning";

export interface ProgressEvent {
  id: string;
  runId?: string;
  requestId?: string;
  phase: string;
  message: string;
  timestamp: string;
  data?: unknown;
}

export class JobQueue {
  private readonly controllers = new Map<string, AbortController>();
  private readonly events = new Map<string, ProgressEvent[]>();

  enqueue(id: string, job: (signal: AbortSignal) => Promise<void>) {
    const controller = new AbortController();
    this.controllers.set(id, controller);
    queueMicrotask(() => {
      void job(controller.signal).finally(() => this.controllers.delete(id));
    });
  }

  cancel(id: string) {
    const controller = this.controllers.get(id);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  publish(key: string, event: Omit<ProgressEvent, "id" | "timestamp">) {
    const item: ProgressEvent = { ...event, id: createId("event"), timestamp: nowIso() };
    const list = this.events.get(key) ?? [];
    list.push(item);
    if (list.length > 500) list.splice(0, list.length - 500);
    this.events.set(key, list);
    return item;
  }

  listEvents(key: string, after?: string) {
    const list = this.events.get(key) ?? [];
    if (!after) return list;
    const index = list.findIndex((event) => event.id === after);
    return index >= 0 ? list.slice(index + 1) : list;
  }
}

export class QaOrchestrator {
  readonly store: QaStore;
  readonly jobs = new JobQueue();

  constructor(
    private readonly environment: QaEnvironment = getEnvironment(),
    store?: QaStore,
  ) {
    this.store = store ?? new QaStore(environment.QA_DATABASE_PATH);
  }

  private planningAdapter() {
    return createPlanningAdapter({
      enabled: this.environment.AI_TEST_PLANNING_ENABLED,
      provider: this.environment.AI_PROVIDER,
      model: this.environment.AI_MODEL,
      apiKey: this.environment.OPENAI_API_KEY,
      timeoutMs: this.environment.AI_REQUEST_TIMEOUT_MS,
      maxInputFiles: this.environment.AI_MAX_INPUT_FILES,
      maxInputBytes: this.environment.AI_MAX_INPUT_BYTES,
    });
  }

  private audit(
    entityType: string,
    entityId: string,
    action: string,
    safeMetadata: Record<string, unknown> = {},
  ) {
    const event: AuditEvent = {
      schemaVersion: "audit-event/v1",
      id: createId("audit"),
      entityType,
      entityId,
      action,
      actor: "local-user",
      safeMetadata,
      createdAt: nowIso(),
    };
    this.store.put("audit_events", event);
  }

  createRequest(input: Omit<QaRequest, "schemaVersion" | "id" | "createdAt">) {
    validateTargetUrl(input.baseUrl, this.environment.QA_ALLOWED_TARGET_HOSTS);
    const request = qaRequestSchema.parse({
      ...input,
      schemaVersion: "qa-request/v1",
      id: createId("request"),
      createdAt: nowIso(),
    });
    this.store.put("requests", request);
    this.audit("request", request.id, "created", {
      workflow: request.workflow,
      environment: request.environment,
    });
    return request;
  }

  startScan(requestId: string) {
    const request = this.requireRequest(requestId);
    if (request.source.mode === "NONE")
      throw new Error("Request does not include a repository source");
    const scanId = createId("scan-job");
    this.jobs.publish(requestId, { requestId, phase: "queued", message: "Repository scan queued" });
    this.jobs.enqueue(scanId, async (signal) => {
      this.jobs.publish(requestId, {
        requestId,
        phase: "scanning",
        message: "Inspecting repository metadata and text",
      });
      if (signal.aborted) return;
      try {
        const connector =
          request.source.mode === "LOCAL"
            ? new LocalRepositoryConnector({
                allowedRoots: this.environment.QA_ALLOWED_REPOSITORY_ROOTS,
                maxFiles: this.environment.QA_MAX_SCAN_FILES,
                maxFileBytes: this.environment.QA_MAX_SCAN_FILE_BYTES,
              })
            : new GitHubRepositoryConnector({
                enabled: this.environment.GITHUB_CONNECTOR_ENABLED,
                token: this.environment.GITHUB_TOKEN,
              });
        const inspected = await analyzeRepository({
          requestId,
          source: request.source,
          connector,
        });
        const cached = this.store.scanByCacheKey(inspected.cacheKey);
        const analysis = cached
          ? { ...cached, id: createId("scan"), requestId, scannedAt: nowIso() }
          : inspected;
        this.store.put("scans", analysis);
        this.audit("repository-scan", analysis.id, cached ? "cache-reused" : "completed", {
          connector: analysis.connectorType,
          commitSha: analysis.commitSha,
        });
        this.jobs.publish(requestId, {
          requestId,
          phase: "planning",
          message: cached ? "Using cached analysis" : "Repository analysis completed",
          data: analysis,
        });
        const plan = await createCandidatePlan({
          request,
          analysis,
          adapter: this.planningAdapter(),
          maxCases: this.environment.QA_MAX_CASES,
        });
        this.store.put("plans", plan);
        this.jobs.publish(requestId, {
          requestId,
          phase: "waiting-for-approval",
          message: "Candidate plan is ready",
          data: plan,
        });
      } catch (error) {
        const blocked = error instanceof Error && error.name === "GitHubConnectorBlocked";
        this.jobs.publish(requestId, {
          requestId,
          phase: blocked ? "blocked" : "failed",
          message: error instanceof Error ? error.message : String(error),
        });
        this.audit("repository-scan", scanId, blocked ? "blocked" : "failed", {
          error: redact(error instanceof Error ? error.message : String(error)),
        });
      }
    });
    return { jobId: scanId, status: "QUEUED" as const };
  }

  async createPlan(requestId: string) {
    const request = this.requireRequest(requestId);
    const analysis = this.store.latestScanForRequest(requestId);
    const plan = await createCandidatePlan({
      request,
      analysis,
      adapter: this.planningAdapter(),
      maxCases: this.environment.QA_MAX_CASES,
    });
    this.store.put("plans", plan);
    this.audit("plan", plan.id, "created", { version: plan.version, adapter: "rule-based" });
    return plan;
  }

  updatePlanItem(planId: string, itemId: string, update: Partial<TestPlanItem>) {
    const plan = this.requirePlan(planId);
    if (!plan.items.some((item) => item.id === itemId))
      throw new Error(`Plan item ${itemId} was not found`);
    const changed = editPlanItem(plan, itemId, update);
    this.store.put("plans", changed);
    this.audit("plan", planId, "item-edited-approval-invalidated", {
      itemId,
      oldVersion: plan.version,
      newVersion: changed.version,
    });
    return changed;
  }

  decidePlanItem(planId: string, itemId: string, decision: "approve" | "reject") {
    const plan = this.requirePlan(planId);
    if (!plan.items.some((item) => item.id === itemId))
      throw new Error(`Plan item ${itemId} was not found`);
    const items = plan.items.map((item) =>
      item.id === itemId
        ? { ...item, approved: decision === "approve", rejected: decision === "reject" }
        : item,
    );
    const updated = testPlanSchema.parse({
      ...plan,
      items,
      status: "WAITING_FOR_APPROVAL",
      updatedAt: nowIso(),
    });
    this.store.put("plans", updated);
    this.audit("plan-item", itemId, decision, { planId, version: plan.version });
    return updated;
  }

  approvePlan(planId: string, stagingApprovedItemIds: string[] = []) {
    const plan = this.requirePlan(planId);
    const approvedItems = plan.items.filter(
      (item) => item.approved && !item.rejected && !item.duplicateOf,
    );
    if (approvedItems.length === 0)
      throw new Error("At least one case must be individually approved");
    const unsupported = approvedItems.filter((item) =>
      ["EXTERNAL_SIDE_EFFECT", "PRODUCTION_MUTATION"].includes(item.sideEffectLevel),
    );
    if (unsupported.length > 0)
      throw new Error("Plans containing prohibited side effects cannot be approved for execution");
    const missingStagingApproval = approvedItems.filter(
      (item) =>
        item.sideEffectLevel === "STAGING_TEST_DATA" && !stagingApprovedItemIds.includes(item.id),
    );
    if (missingStagingApproval.length > 0) {
      throw new Error(
        `Additional staging approval is required for ${missingStagingApproval.map((item) => item.id).join(", ")}`,
      );
    }
    const approval = planApprovalSchema.parse({
      schemaVersion: "plan-approval/v1",
      id: createId("approval"),
      planId: plan.id,
      planVersion: plan.version,
      approvedItemIds: approvedItems.map((item) => item.id),
      stagingApprovedItemIds,
      approvedBy: "local-user",
      approvedAt: nowIso(),
    });
    const approvedPlan = testPlanSchema.parse({ ...plan, status: "APPROVED", updatedAt: nowIso() });
    this.store.put("plans", approvedPlan);
    this.store.put("approvals", approval);
    this.audit("plan", plan.id, "approved", {
      version: plan.version,
      approvedItemIds: approval.approvedItemIds,
    });
    return { plan: approvedPlan, approval };
  }

  startRun(planId: string, options: { parentRunId?: string; failuresOnly?: boolean } = {}) {
    const plan = this.requirePlan(planId);
    const approval = this.store.approvalForPlan(plan.id, plan.version);
    if (plan.status !== "APPROVED" || !approval)
      throw new Error("An exact-version plan approval is required before execution");
    const request = this.requireRequest(plan.requestId);
    validateTargetUrl(request.baseUrl, this.environment.QA_ALLOWED_TARGET_HOSTS);
    let selectedIds = approval.approvedItemIds;
    if (options.failuresOnly) {
      if (!options.parentRunId) throw new Error("Failure rerun requires a parent run");
      const parent = this.requireRun(options.parentRunId);
      selectedIds = parent.results
        .filter((result) => result.status === "FAIL")
        .map((result) => result.testId);
      if (selectedIds.length === 0) throw new Error("Parent run has no failed cases");
    }
    const run = qaRunSchema.parse({
      schemaVersion: "qa-run/v1",
      id: createId("run"),
      requestId: request.id,
      planId: plan.id,
      planVersion: plan.version,
      parentRunId: options.parentRunId,
      rerunMode: options.parentRunId ? (options.failuresOnly ? "FAILURES" : "FULL") : "NONE",
      status: "QUEUED",
      phase: "queued",
      completedTestIds: [],
      results: [],
      createdAt: nowIso(),
      cancelRequested: false,
    });
    this.store.put("runs", run);
    this.audit("run", run.id, "queued", { planId, planVersion: plan.version, selectedIds });
    this.jobs.publish(run.id, { runId: run.id, phase: "queued", message: "Approved run queued" });
    this.jobs.enqueue(run.id, (signal) =>
      this.executeRun({ run, plan, request, approval, selectedIds, signal }),
    );
    return run;
  }

  private async executeRun(input: {
    run: QaRun;
    plan: TestPlan;
    request: QaRequest;
    approval: PlanApproval;
    selectedIds: string[];
    signal: AbortSignal;
  }) {
    const timeoutSignal = AbortSignal.timeout(this.environment.QA_RUN_TIMEOUT_MS);
    const signal = AbortSignal.any([input.signal, timeoutSignal]);
    let run: QaRun = {
      ...input.run,
      status: "RUNNING",
      phase: "running",
      startedAt: nowIso(),
    };
    this.store.put("runs", run);
    const runner = new PlaywrightQaRunner({
      evidenceRoot: `${this.environment.QA_DATA_DIR}/evidence`,
      timeoutMs: this.environment.QA_BROWSER_TIMEOUT_MS,
      retries: this.environment.QA_ACTION_RETRIES,
    });
    const selectedIds = new Set(input.selectedIds);
    const stagingApprovedIds = new Set(input.approval.stagingApprovedItemIds);
    const selected = input.plan.items.filter((item) => selectedIds.has(item.id));
    for (const item of selected) {
      if (signal.aborted) break;
      run = { ...run, currentTestId: item.id };
      this.store.put("runs", run);
      this.jobs.publish(run.id, {
        runId: run.id,
        phase: "running",
        message: `Running ${item.id}: ${item.title}`,
      });
      const result = await runner.runCase({
        runId: run.id,
        item: {
          ...item,
          requiresStagingApproval:
            item.sideEffectLevel === "STAGING_TEST_DATA" && !stagingApprovedIds.has(item.id),
        },
        baseUrl: input.request.baseUrl,
        signal,
        onEvent: (event: RunnerEvent) =>
          this.jobs.publish(run.id, {
            runId: run.id,
            phase: "running",
            message: event.message,
            data: event,
          }),
      });
      run = {
        ...run,
        results: [...run.results, result],
        completedTestIds: [...run.completedTestIds, item.id],
      };
      this.store.put("runs", run);
    }
    const completedIds = new Set(run.completedTestIds);
    for (const item of selected.filter((item) => !completedIds.has(item.id))) {
      const timestamp = nowIso();
      run.results.push({
        schemaVersion: "test-result/v1",
        id: createId("result"),
        runId: run.id,
        testId: item.id,
        status: "NOT_EXECUTED",
        expectedResult: item.expectedResult,
        actualResult: "Run was cancelled before this case started",
        evidence: [],
        retryCount: 0,
        durationMs: 0,
        startedAt: timestamp,
        completedAt: timestamp,
      });
    }
    if (signal.aborted) {
      const timedOut = timeoutSignal.aborted && !input.signal.aborted;
      run = {
        ...run,
        status: timedOut ? "FAILED" : "CANCELLED",
        phase: timedOut ? "failed" : "cancelled",
        cancelRequested: !timedOut,
        currentTestId: undefined,
        blockerMessage: timedOut
          ? `Run exceeded the configured ${this.environment.QA_RUN_TIMEOUT_MS} ms timeout`
          : undefined,
        completedAt: nowIso(),
      };
      this.store.put("runs", run);
      this.audit("run", run.id, timedOut ? "timed-out" : "cancelled");
      this.jobs.publish(run.id, {
        runId: run.id,
        phase: run.phase,
        message: run.blockerMessage ?? "Run cancelled safely",
      });
      return;
    }
    run = { ...run, status: "REPORTING", phase: "reporting", currentTestId: undefined };
    this.store.put("runs", run);
    this.jobs.publish(run.id, { runId: run.id, phase: "reporting", message: "Generating reports" });
    try {
      const analysis = this.store.latestScanForRequest(input.request.id);
      const report = createReport({
        request: input.request,
        plan: input.plan,
        approval: input.approval,
        run,
        analysis,
      });
      await writeReports(`${this.environment.QA_DATA_DIR}/reports`, report);
      run = { ...run, status: "COMPLETED", phase: "completed", completedAt: nowIso() };
      this.store.put("runs", run);
      this.audit("run", run.id, "completed", { totals: report.totals });
      this.jobs.publish(run.id, {
        runId: run.id,
        phase: "completed",
        message: "Run and reports completed",
        data: report.totals,
      });
    } catch (error) {
      run = {
        ...run,
        status: "FAILED",
        phase: "failed",
        blockerMessage: error instanceof Error ? error.message : String(error),
        completedAt: nowIso(),
      };
      this.store.put("runs", run);
      this.jobs.publish(run.id, { runId: run.id, phase: "failed", message: run.blockerMessage! });
    }
  }

  cancelRun(runId: string) {
    const run = this.requireRun(runId);
    const cancelled = this.jobs.cancel(runId);
    if (!cancelled && ["COMPLETED", "CANCELLED", "FAILED"].includes(run.status)) return run;
    const updated = { ...run, cancelRequested: true };
    this.store.put("runs", updated);
    this.audit("run", runId, "cancellation-requested");
    return updated;
  }

  private requireRequest(id: string) {
    const request = this.store.get<QaRequest>("requests", id);
    if (!request) throw new Error(`Request ${id} was not found`);
    return request;
  }

  private requirePlan(id: string) {
    const plan = this.store.get<TestPlan>("plans", id);
    if (!plan) throw new Error(`Plan ${id} was not found`);
    return plan;
  }

  private requireRun(id: string) {
    const run = this.store.get<QaRun>("runs", id);
    if (!run) throw new Error(`Run ${id} was not found`);
    return run;
  }
}
