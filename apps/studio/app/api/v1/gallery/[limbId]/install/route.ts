import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateRequest, StudioAuthError } from "@/server/auth";
import { isFeatureEnabled } from "@/server/config";
import { getStudioDaemon } from "@/server/daemon";
import { WebhookEntitlementVerifier } from "@/server/entitlements";
import {
  createSalamandaClientFromEnv,
  EgressConsentRequiredError,
  updateMySalamandaBindings,
} from "@/server/salamanda-deployer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const InstallBodySchema = z.object({
  approvedEgressHosts: z.array(z.string()).optional(),
  receiptId: z.string().nullable().optional(),
  skipSalamandaBind: z.boolean().optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ limbId: string }> }
) {
  if (!isFeatureEnabled("gallery")) {
    return NextResponse.json(
      { error: "Not found: gallery feature is disabled (enable 'gallery' in NEWT_FEATURES)." },
      { status: 404 }
    );
  }

  try {
    const { principalUid, auth } = await authenticateRequest(request);
    const { limbId } = await context.params;
    const raw = await request.text();
    const body = raw.trim() ? InstallBodySchema.parse(JSON.parse(raw)) : {};
    const daemon = getStudioDaemon();

    const listing = daemon.db.getGalleryListing(limbId);
    if (!listing) {
      return NextResponse.json({ error: `Gallery listing '${limbId}' not found` }, { status: 404 });
    }

    // 1. Pluggable Entitlement Verification (`free`, `allowlist`, or `ledger_gate` webhook)
    const verifier = new WebhookEntitlementVerifier(daemon.db);
    const ent = await verifier.verify({
      listing,
      consumerUid: principalUid,
      receiptId: body.receiptId,
      userBearerToken: auth.userBearerToken,
    });
    if (!ent.entitled) {
      return NextResponse.json(
        {
          error: ent.reason ?? "Entitlement required to install this Limb",
          code: "NEWT-ENTITLEMENT-REQUIRED",
          monetizationMode: listing.monetizationMode,
          priceLabel: listing.priceLabel,
          checkoutUrl: ent.checkoutUrl ?? null,
        },
        { status: 402 }
      );
    }

    // 2. Human Egress Consent Gate (`NEWT-CONSENT-001`)
    const approvedSet = new Set(
      (body.approvedEgressHosts ?? []).map((h) => h.toLowerCase())
    );
    const unapprovedEgress = listing.permissionsSummary.egress.filter(
      (h) => !approvedSet.has(h.toLowerCase())
    );
    if (unapprovedEgress.length > 0) {
      throw new EgressConsentRequiredError(unapprovedEgress);
    }

    // 3. Record free install grant if not already granted
    if (!ent.grant && listing.monetizationMode === "free") {
      daemon.db.grantEntitlement({
        limbId: listing.limbId,
        consumerUid: principalUid,
        grantSource: "free_install",
      });
    }

    // 4. Bind on Salamanda via ClientDelegationAuth (unless explicitly skipped)
    let bindings: string[] = [listing.limbId];
    if (!body.skipSalamandaBind) {
      const client = createSalamandaClientFromEnv();
      const current = await client.getBindings(principalUid);
      const merged = Array.from(new Set([...current.limbs, listing.limbId]));
      const updated = await updateMySalamandaBindings(daemon, {
        principalUid,
        auth,
        limbs: merged,
        approvedEgressHosts: body.approvedEgressHosts,
        client,
      });
      bindings = updated.limbs;
    }

    return NextResponse.json({
      installed: true,
      limbId: listing.limbId,
      principalUid,
      bindings,
    });
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
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
