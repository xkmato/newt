import { NextResponse } from "next/server";
import { getStudioDaemon } from "@/server/daemon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const daemon = getStudioDaemon();
  return NextResponse.json(daemon.health());
}
