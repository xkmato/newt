import { NextResponse } from "next/server";
import { z } from "zod";
import { assertProjectOwnership, authenticateRequest, StudioAuthError } from "@/server/auth";
import { getStudioDaemon } from "@/server/daemon";
import {
  DeploymentAuthorizationError,
  EgressConsentRequiredError,
  previewProjectOnSalamanda,
} from "@/server/salamanda-deployer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PreviewBodySchema = z.object({
  approvedEgressHosts: z.array(z.string()).optional(),
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

    const raw = await request.text();
    const body = raw.trim() ? PreviewBodySchema.parse(JSON.parse(raw)) : {};

    const result = await previewProjectOnSalamanda(daemon, {
      projectId: id,
      principalUid: principal.principalUid,
      auth: principal.auth,
      approvedEgressHosts: body.approvedEgressHosts,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof StudioAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof EgressConsentRequiredError) {
      return NextResponse.json(
        {
          error: err.message,
          code: err.code,
          requiresEgressConsent: true,
          unapprovedEgressHosts: err.unapprovedEgressHosts,
        },
        { status: 409 }
      );
    }
    if (err instanceof DeploymentAuthorizationError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
