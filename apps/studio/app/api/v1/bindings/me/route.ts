import { NextResponse } from "next/server";
import { z } from "zod";
import { getStudioDaemon } from "@/server/daemon";
import {
  createSalamandaClientFromEnv,
  EgressConsentRequiredError,
  extractDelegatedPrincipal,
  updateMySalamandaBindings,
} from "@/server/salamanda-deployer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PutBindingsSchema = z.object({
  limbs: z.array(z.string().min(1)),
  approvedEgressHosts: z.array(z.string()).optional(),
});

export async function GET(request: Request) {
  try {
    const { principalUid } = extractDelegatedPrincipal(request);
    const client = createSalamandaClientFromEnv();
    const res = await client.getBindings(principalUid);
    return NextResponse.json({
      principalUid: res.principal_uid,
      limbs: res.limbs,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = PutBindingsSchema.parse(await request.json());
    const { principalUid, auth } = extractDelegatedPrincipal(request);
    const daemon = getStudioDaemon();

    const updated = await updateMySalamandaBindings(daemon, {
      principalUid,
      auth,
      limbs: body.limbs,
      approvedEgressHosts: body.approvedEgressHosts,
    });

    return NextResponse.json(updated);
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
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { principalUid, auth } = extractDelegatedPrincipal(request);
    const client = createSalamandaClientFromEnv();
    const res = await client.resetBindings(auth, principalUid);
    return NextResponse.json({
      principalUid: res.principal_uid,
      limbs: res.limbs,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
