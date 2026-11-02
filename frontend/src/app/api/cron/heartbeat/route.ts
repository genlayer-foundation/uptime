import { NextResponse } from "next/server";
import { runTick } from "@/lib/heartbeat/runner";
import { authorized } from "@/lib/heartbeat/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const probes = await runTick();
    return NextResponse.json({ probes });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
