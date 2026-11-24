import { NextResponse } from "next/server";
import { z } from "zod";
import { getStudioDaemon } from "@/server/daemon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RollbackSchema = z.object({
  snapshotId: z.number().int().positive(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = RollbackSchema.parse(await request.json());
    const daemon = getStudioDaemon();
    const rolled = daemon.rollbackProject(id, body.snapshotId);
    return NextResponse.json(rolled);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("does not belong") || message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
