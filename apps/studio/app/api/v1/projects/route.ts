import { NextResponse } from "next/server";
import { z } from "zod";
import { getStudioDaemon } from "@/server/daemon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CreateProjectSchema = z.object({
  name: z.string().min(1).max(120),
  mode: z.enum(["standalone-ui", "salamanda-limb"]).default("salamanda-limb"),
  baseTarget: z.string().min(1).optional(),
  limbId: z.string().min(1).optional(),
  slotId: z.string().min(1).optional(),
  initialFiles: z.record(z.string()).optional(),
});

function resolveUid(request: Request): string {
  return request.headers.get("x-newt-uid")?.trim() || "uid:studio";
}

export async function GET(request: Request) {
  const daemon = getStudioDaemon();
  const ownerUid = resolveUid(request);
  const projects = daemon.listProjects(ownerUid);
  return NextResponse.json({ projects });
}

export async function POST(request: Request) {
  try {
    const body = CreateProjectSchema.parse(await request.json());
    const daemon = getStudioDaemon();
    const ownerUid = resolveUid(request);

    const created = await daemon.createProject({
      ownerUid,
      name: body.name,
      mode: body.mode,
      baseTarget: body.baseTarget,
      limbId: body.limbId,
      slotId: body.slotId,
      initialFiles: body.initialFiles,
    });

    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
