import { NextResponse } from "next/server";
import { z } from "zod";
import { getStudioDaemon } from "@/server/daemon";
import { extractDelegatedPrincipal } from "@/server/salamanda-deployer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GrantBodySchema = z.object({
  consumerUid: z.string().min(1),
  grantSource: z.enum(["author_invite", "payment_receipt", "free_install"]).default("author_invite"),
  externalReceiptId: z.string().nullable().optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ limbId: string }> }
) {
  try {
    const { limbId } = await context.params;
    const body = GrantBodySchema.parse(await request.json());
    const { principalUid } = extractDelegatedPrincipal(request);
    const daemon = getStudioDaemon();

    const listing = daemon.db.getGalleryListing(limbId);
    if (!listing) {
      return NextResponse.json({ error: `Gallery listing '${limbId}' not found` }, { status: 404 });
    }
    if (listing.authorUid !== principalUid) {
      return NextResponse.json(
        { error: `Only listing author '${listing.authorUid}' can grant allowlist entitlements` },
        { status: 403 }
      );
    }

    const grant = daemon.db.grantEntitlement({
      limbId,
      consumerUid: body.consumerUid,
      grantSource: body.grantSource,
      externalReceiptId: body.externalReceiptId ?? null,
    });

    return NextResponse.json({ granted: true, grant }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
