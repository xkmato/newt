import { NextResponse } from "next/server";
import { z } from "zod";
import { assertProjectOwnership, authenticateRequest, StudioAuthError } from "@/server/auth";
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
    const principal = await authenticateRequest(request);
    const { id } = await context.params;
    const daemon = getStudioDaemon();
    const project = daemon.db.getProject(id);
    if (!project) {
      return NextResponse.json({ error: `Project '${id}' not found` }, { status: 404 });
    }
    assertProjectOwnership(project, principal);

    const body = RollbackSchema.parse(await request.json());
    const rolled = daemon.rollbackProject(id, body.snapshotId);
    return NextResponse.json(rolled);
  } catch (err) {
    if (err instanceof StudioAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("does not belong") || message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
