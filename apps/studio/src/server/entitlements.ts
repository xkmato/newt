import crypto from "node:crypto";
import type { EntitlementGrantRecord, GalleryListingRecord, NewtDatabase } from "@newt/db";

export interface EntitlementCheckRequest {
  listing: GalleryListingRecord;
  consumerUid: string;
  receiptId?: string | null;
  userBearerToken?: string;
}

export interface EntitlementCheckResult {
  entitled: boolean;
  reason?: string;
  grant?: EntitlementGrantRecord;
  checkoutUrl?: string;
}

export interface EntitlementVerifier {
  verify(req: EntitlementCheckRequest): Promise<EntitlementCheckResult>;
}

/**
 * Pluggable platform-agnostic Entitlement Verifier:
 * - `free` or Limb author -> immediately entitled (`free_install`).
 * - `allowlist` -> checks `entitlement_grants` table in `@newt/db`.
 * - `ledger_gate` -> checks cached `entitlement_grants`, and if absent, calls the configured
 *   host platform billing/ledger webhook (`NEWT_ENTITLEMENT_WEBHOOK_URL`) with optional
 *   HMAC-SHA256 `X-Newt-Signature` (supporting XKmato's ledger or any third-party billing API).
 */
export class WebhookEntitlementVerifier implements EntitlementVerifier {
  constructor(
    private readonly db: NewtDatabase,
    private readonly options?: {
      webhookUrl?: string;
      webhookSecret?: string;
      fetchImpl?: typeof fetch;
    }
  ) {}

  async verify(req: EntitlementCheckRequest): Promise<EntitlementCheckResult> {
    const { listing, consumerUid } = req;

    if (listing.authorUid === consumerUid || listing.monetizationMode === "free") {
      return { entitled: true };
    }

    if (this.db.hasEntitlement(listing.limbId, consumerUid)) {
      return { entitled: true };
    }

    if (listing.monetizationMode === "allowlist") {
      return {
        entitled: false,
        reason: `Limb '${listing.limbId}' is invite-only (allowlist). Ask the author for access.`,
      };
    }

    // `ledger_gate` -> consult configured host platform billing/ledger webhook
    const webhookUrl =
      this.options?.webhookUrl ?? process.env.NEWT_ENTITLEMENT_WEBHOOK_URL?.trim();
    if (!webhookUrl) {
      return {
        entitled: false,
        reason: `Limb '${listing.limbId}' requires a paid entitlement (${listing.priceLabel ?? "paid"}), and no host entitlement webhook is configured.`,
      };
    }

    const payloadObj = {
      limbId: listing.limbId,
      baseTarget: listing.baseTarget,
      authorUid: listing.authorUid,
      consumerUid,
      priceLabel: listing.priceLabel,
      receiptId: req.receiptId ?? null,
    };
    const payloadJson = JSON.stringify(payloadObj);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const secret = this.options?.webhookSecret ?? process.env.NEWT_ENTITLEMENT_WEBHOOK_SECRET;
    if (secret) {
      const sig = crypto.createHmac("sha256", secret).update(payloadJson).digest("hex");
      headers["X-Newt-Signature"] = `sha256=${sig}`;
    }
    if (req.userBearerToken) {
      headers.Authorization = `Bearer ${req.userBearerToken}`;
    }

    const fetchFn = this.options?.fetchImpl ?? fetch;
    const res = await fetchFn(webhookUrl, {
      method: "POST",
      headers,
      body: payloadJson,
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      return {
        entitled: false,
        reason: `Host entitlement verifier rejected request (HTTP ${res.status})`,
      };
    }

    const body = (await res.json()) as {
      entitled?: boolean;
      receiptId?: string | null;
      reason?: string;
      checkoutUrl?: string;
    };

    if (!body.entitled) {
      return {
        entitled: false,
        reason: body.reason ?? `Payment or subscription required (${listing.priceLabel ?? "paid"})`,
        checkoutUrl: body.checkoutUrl,
      };
    }

    const grant = this.db.grantEntitlement({
      limbId: listing.limbId,
      consumerUid,
      grantSource: "payment_receipt",
      externalReceiptId: body.receiptId ?? req.receiptId ?? null,
    });

    return { entitled: true, grant };
  }
}
