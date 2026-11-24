import { NextResponse } from "next/server";
import { z } from "zod";
import { getStudioDaemon } from "@/server/daemon";
import {
  DeploymentAuthorizationError,
  deployProjectToSalamanda,
  EgressConsentRequiredError,
  extractDelegatedPrincipal,
} from "@/server/salamanda-deployer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DeployBodySchema = z.object({
  approvedEgressHosts: z.array(z.string()).optional(),
  bindToSelf: z.boolean().optional(),
  environment: z
    .enum(["local-dev", "xkmato-preview", "xkmato-published", "custom"])
    .optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const raw = await request.text();
    const body = raw.trim() ? DeployBodySchema.parse(JSON.parse(raw)) : {};
    const { principalUid, auth } = extractDelegatedPrincipal(request);
    const daemon = getStudioDaemon();

    const result = await deployProjectToSalamanda(daemon, {
      projectId: id,
      principalUid,
      auth,
      approvedEgressHosts: body.approvedEgressHosts,
      bindToSelf: body.bindToSelf,
      environment: body.environment,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (err) {
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
