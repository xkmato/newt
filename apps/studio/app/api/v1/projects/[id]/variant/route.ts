import { NextResponse } from "next/server";
import { assertProjectOwnership, authenticateRequest, StudioAuthError } from "@/server/auth";
import { isFeatureEnabled } from "@/server/config";
import { getStudioDaemon } from "@/server/daemon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  if (!isFeatureEnabled("l3")) {
    return NextResponse.json(
      { error: "Not found: Level 3 Variant authoring is disabled (enable 'l3' in NEWT_FEATURES)." },
      { status: 404 }
    );
  }

  try {
    const principal = await authenticateRequest(request);
    const { id } = await context.params;
    const daemon = getStudioDaemon();
    const project = daemon.db.getProject(id);
    if (!project) {
      return NextResponse.json({ error: `Project '${id}' not found` }, { status: 404 });
    }
    assertProjectOwnership(project, principal);

    const snap = daemon.db.getCurrentSnapshot(id);
    const variant = daemon.variants.getForProject(id);
    const patch = snap?.compiledBundle?.variantPatch ?? null;

    return NextResponse.json({
      projectId: id,
      l3Enabled: true,
      patch,
      variant,
    });
  } catch (err) {
    if (err instanceof StudioAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
