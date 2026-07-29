import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import type { QaRequest, QaRun, TestPlan, TestPlanItem } from "@qa/schemas";
import { repositorySourceSchema, testPlanItemSchema } from "@qa/schemas";
import { redact } from "@qa/security";
import { getEnvironment } from "@qa/shared";
import { z } from "zod";
import { getOrchestrator } from "../../../../lib/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const requestInputSchema = z.object({
  workflow: z.enum(["MANUAL", "REPOSITORY", "REPOSITORY_WITH_CASES", "NO_CASES"]),
  applicationName: z.string().min(2).max(120),
  baseUrl: z.string().url(),
  environment: z.enum(["LOCAL", "TEST", "STAGING"]),
  objective: z.string().min(3).max(5000),
  source: repositorySourceSchema,
  existingCasesText: z.string().max(50_000).default(""),
  estimatedManualMinutes: z.number().nonnegative().optional(),
  configurationFile: z.string().optional(),
});
const decisionSchema = z.object({ decision: z.enum(["approve", "reject"]) });
const approvalSchema = z.object({ stagingApprovedItemIds: z.array(z.string()).default([]) });
const itemUpdateSchema = testPlanItemSchema.partial().omit({ id: true, schemaVersion: true });

function parts(context: { params: Promise<{ path: string[] }> }) {
  return context.params.then((params) => params.path);
}

function ok(data: unknown, status = 200) {
  return NextResponse.json({ data }, { status });
}

function failure(error: unknown) {
  const message = String(redact(error instanceof Error ? error.message : String(error)));
  const validation = error instanceof z.ZodError ? error.flatten() : undefined;
  return NextResponse.json(
    { error: message, validation },
    { status: error instanceof z.ZodError ? 400 : 409 },
  );
}

export async function GET(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  try {
    const orchestrator = getOrchestrator();
    const path = await parts(context);
    if (path[0] === "runs" && path.length === 1) return ok(orchestrator.store.list<QaRun>("runs"));
    if (path[0] === "runs" && path[1] && path[2] === "events") {
      return ok(
        orchestrator.jobs.listEvents(
          path[1],
          request.nextUrl.searchParams.get("after") ?? undefined,
        ),
      );
    }
    if (path[0] === "runs" && path[1] && path[2] === "report") {
      const run = orchestrator.store.get<QaRun>("runs", path[1]);
      if (!run) throw new Error("Run not found");
      const reportPath = join(getEnvironment().QA_DATA_DIR, "reports", run.id, "report.json");
      return ok(JSON.parse(await readFile(reportPath, "utf8")));
    }
    if (path[0] === "runs" && path[1]) {
      const run = orchestrator.store.get<QaRun>("runs", path[1]);
      if (!run) throw new Error("Run not found");
      return ok(run);
    }
    if (path[0] === "requests" && path[1]) {
      const qaRequest = orchestrator.store.get<QaRequest>("requests", path[1]);
      if (!qaRequest) throw new Error("Request not found");
      const plan = orchestrator.store.latestPlanForRequest(path[1]);
      const scan = orchestrator.store.latestScanForRequest(path[1]);
      return ok({ request: qaRequest, plan, scan, events: orchestrator.jobs.listEvents(path[1]) });
    }
    if (path[0] === "plans" && path[1]) {
      const plan = orchestrator.store.get<TestPlan>("plans", path[1]);
      if (!plan) throw new Error("Plan not found");
      return ok(plan);
    }
    throw new Error("API route not found");
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  try {
    const orchestrator = getOrchestrator();
    const path = await parts(context);
    const body = await request.json().catch(() => ({}));
    if (path[0] === "requests" && path.length === 1) {
      return ok(orchestrator.createRequest(requestInputSchema.parse(body)), 201);
    }
    if (path[0] === "requests" && path[1] && path[2] === "scan") {
      return ok(orchestrator.startScan(path[1]), 202);
    }
    if (path[0] === "requests" && path[1] && path[2] === "plan") {
      return ok(await orchestrator.createPlan(path[1]), 201);
    }
    if (
      path[0] === "plans" &&
      path[1] &&
      path[2] === "items" &&
      path[3] &&
      path[4] === "decision"
    ) {
      const input = decisionSchema.parse(body);
      return ok(orchestrator.decidePlanItem(path[1], path[3], input.decision));
    }
    if (path[0] === "plans" && path[1] && path[2] === "approve") {
      const input = approvalSchema.parse(body);
      return ok(orchestrator.approvePlan(path[1], input.stagingApprovedItemIds));
    }
    if (path[0] === "plans" && path[1] && path[2] === "run") {
      return ok(orchestrator.startRun(path[1]), 202);
    }
    if (path[0] === "runs" && path[1] && path[2] === "cancel") {
      return ok(orchestrator.cancelRun(path[1]));
    }
    if (path[0] === "runs" && path[1] && path[2] === "rerun") {
      const parent = orchestrator.store.get<QaRun>("runs", path[1]);
      if (!parent) throw new Error("Run not found");
      const input = z.object({ mode: z.enum(["FULL", "FAILURES"]) }).parse(body);
      return ok(
        orchestrator.startRun(parent.planId, {
          parentRunId: parent.id,
          failuresOnly: input.mode === "FAILURES",
        }),
        202,
      );
    }
    throw new Error("API route not found");
  } catch (error) {
    return failure(error);
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  try {
    const orchestrator = getOrchestrator();
    const path = await parts(context);
    const body = itemUpdateSchema.parse(await request.json());
    if (path[0] === "plans" && path[1] && path[2] === "items" && path[3]) {
      return ok(orchestrator.updatePlanItem(path[1], path[3], body as Partial<TestPlanItem>));
    }
    throw new Error("API route not found");
  } catch (error) {
    return failure(error);
  }
}
