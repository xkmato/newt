import { NextResponse } from "next/server";
import { getStudioDaemon } from "@/server/daemon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const daemon = getStudioDaemon();
  const detail = daemon.getProjectDetail(id);
  if (!detail) {
    return NextResponse.json({ error: `Project '${id}' not found` }, { status: 404 });
  }
  return NextResponse.json(detail);
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const daemon = getStudioDaemon();
  const deleted = daemon.db.deleteProject(id);
  if (!deleted) {
    return NextResponse.json({ error: `Project '${id}' not found` }, { status: 404 });
  }
  return NextResponse.json({ deleted: true, id });
}
