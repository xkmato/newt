import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateRequest, StudioAuthError } from "@/server/auth";
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

export async function GET(request: Request) {
  try {
    const principal = await authenticateRequest(request);
    const daemon = getStudioDaemon();
    const projects = daemon.listProjects(principal.principalUid);
    return NextResponse.json({ projects });
  } catch (err) {
    if (err instanceof StudioAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const principal = await authenticateRequest(request);
    const body = CreateProjectSchema.parse(await request.json());
    const daemon = getStudioDaemon();

    const created = await daemon.createProject({
      ownerUid: principal.principalUid,
      name: body.name,
      mode: body.mode,
      baseTarget: body.baseTarget,
      limbId: body.limbId,
      slotId: body.slotId,
      initialFiles: body.initialFiles,
    });

    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    if (err instanceof StudioAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
