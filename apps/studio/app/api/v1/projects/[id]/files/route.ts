import { NextResponse } from "next/server";
import { z } from "zod";
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
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const daemon = getStudioDaemon();
  const detail = daemon.getProjectDetail(id);
  if (!detail) {
    return NextResponse.json({ error: `Project '${id}' not found` }, { status: 404 });
  }
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
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = UpdateFilesSchema.parse(await request.json());
    if (!body.files && !body.patch) {
      return NextResponse.json(
        { error: "Provide either 'files' or 'patch' in request body" },
        { status: 400 }
      );
    }

    const daemon = getStudioDaemon();
    const updated = await daemon.updateProjectFiles(id, body);
    return NextResponse.json(updated);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
