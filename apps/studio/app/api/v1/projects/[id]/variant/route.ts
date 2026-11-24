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
  const project = daemon.db.getProject(id);
  if (!project) {
    return NextResponse.json({ error: `Project '${id}' not found` }, { status: 404 });
  }

  const snap = daemon.db.getCurrentSnapshot(id);
  const variant = daemon.variants.getForProject(id);
  const patch = snap?.compiledBundle?.variantPatch ?? null;

  return NextResponse.json({
    projectId: id,
    l3Enabled: process.env.NEWT_ENABLE_L3_VARIANTS === "1",
    patch,
    variant,
  });
}
