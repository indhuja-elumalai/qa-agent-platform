import { NextResponse } from "next/server";
import { nowIso } from "@qa/shared";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    status: "ok",
    service: "qa-agent-platform",
    timestamp: nowIso(),
  });
}
