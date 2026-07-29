import { NextResponse } from "next/server";
import { getOrchestrator } from "../../../lib/service";

export const dynamic = "force-dynamic";

export function GET() {
  try {
    const orchestrator = getOrchestrator();
    orchestrator.store.list("requests", 1);
    return NextResponse.json({ status: "ready", database: "available" });
  } catch {
    return NextResponse.json(
      { status: "not-ready", reason: "Database is unavailable" },
      { status: 503 },
    );
  }
}
