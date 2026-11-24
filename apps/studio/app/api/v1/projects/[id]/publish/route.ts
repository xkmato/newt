import { NextResponse } from "next/server";
import { z } from "zod";
import { getStudioDaemon } from "@/server/daemon";
import {
  DeploymentAuthorizationError,
  EgressConsentRequiredError,
  extractDelegatedPrincipal,
  publishProjectToSalamanda,
} from "@/server/salamanda-deployer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PublishBodySchema = z.object({
  approvedEgressHosts: z.array(z.string()).optional(),
  title: z.string().min(1).max(120).optional(),
  description: z.string().max(1000).optional(),
  visibility: z.enum(["unlisted", "public"]).optional(),
  monetizationMode: z.enum(["free", "allowlist", "ledger_gate"]).optional(),
  priceLabel: z.string().max(40).nullable().optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const raw = await request.text();
    const body = raw.trim() ? PublishBodySchema.parse(JSON.parse(raw)) : {};
    const { principalUid, auth } = extractDelegatedPrincipal(request);
    const daemon = getStudioDaemon();

    const result = await publishProjectToSalamanda(daemon, {
      projectId: id,
      principalUid,
      auth,
      approvedEgressHosts: body.approvedEgressHosts,
      title: body.title,
      description: body.description,
      visibility: body.visibility,
      monetizationMode: body.monetizationMode,
      priceLabel: body.priceLabel,
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
