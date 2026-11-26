import { NextResponse } from "next/server";
import { z } from "zod";
import { assertProjectOwnership, authenticateRequest, StudioAuthError } from "@/server/auth";
import { getStudioDaemon } from "@/server/daemon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UpdateFilesSchema = z.object({
  files: z.record(z.string()).optional(),
  patch: z.record(z.string().nullable()).optional(),
  summary: z.string().max(240).optional(),
  approvedEgressHosts: z.array(z.string()).optional(),
});

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const principal = await authenticateRequest(request);
    const { id } = await context.params;
    const daemon = getStudioDaemon();
    const detail = daemon.getProjectDetail(id);
    if (!detail) {
      return NextResponse.json({ error: `Project '${id}' not found` }, { status: 404 });
    }
    assertProjectOwnership(detail.project, principal);
    return NextResponse.json({
      projectId: id,
      snapshotId: detail.currentSnapshot?.id ?? null,
      files: detail.currentSnapshot?.files ?? {},
      compiled: detail.currentSnapshot?.compiledBundle ?? null,
      diff: detail.diff,
      snapshots: detail.snapshots.map((s) => ({
        id: s.id,
        parentSnapshotId: s.parentSnapshotId,
        summary: s.summary,
        createdAt: s.createdAt,
        valid: s.compiledBundle?.valid ?? false,
      })),
    });
  } catch (err) {
    if (err instanceof StudioAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(
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

    const body = UpdateFilesSchema.parse(await request.json());
    if (!body.files && !body.patch) {
      return NextResponse.json(
        { error: "Provide either 'files' or 'patch' in request body" },
        { status: 400 }
      );
    }

    const updated = await daemon.updateProjectFiles(id, body);
    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof StudioAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
