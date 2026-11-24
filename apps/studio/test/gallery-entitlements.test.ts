import crypto from "node:crypto";
import http from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as getGallery } from "../app/api/v1/gallery/route";
import { POST as postGrantEntitlement } from "../app/api/v1/gallery/[limbId]/entitlements/route";
import { POST as postInstallLimb } from "../app/api/v1/gallery/[limbId]/install/route";
import { setStudioDaemonForTesting, StudioDaemon } from "../src/server/daemon";

describe("Task 5.2 — Gallery, Permission Consent & Pluggable EntitlementVerifier Webhook", () => {
  let daemon: StudioDaemon;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv.NEWT_ENTITLEMENT_WEBHOOK_URL = process.env.NEWT_ENTITLEMENT_WEBHOOK_URL;
    savedEnv.NEWT_ENTITLEMENT_WEBHOOK_SECRET = process.env.NEWT_ENTITLEMENT_WEBHOOK_SECRET;

    daemon = new StudioDaemon({ dbPath: ":memory:" });
    setStudioDaemonForTesting(daemon);
  });

  afterEach(() => {
    daemon.db.close();
    setStudioDaemonForTesting(undefined);

    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("enforces allowlist grants, external HMAC-signed ledger_gate webhook (402 -> 200), and NEWT-CONSENT-001 (409 -> 200)", async () => {
    const project = daemon.db.createProject({
      ownerUid: "uid:kenneth",
      limbId: "pro-luganda-tts",
      name: "Pro Luganda TTS",
      mode: "salamanda-limb",
      baseTarget: "xkmato",
    });

    daemon.db.upsertGalleryListing({
      limbId: "pro-luganda-tts",
      projectId: project.id,
      authorUid: "uid:kenneth",
      title: "Pro Luganda TTS",
      description: "High-craft Luganda speech synthesis for XKmato essays.",
      baseTarget: "xkmato",
      publishedDigest: "sha256:abc123",
      visibility: "public",
      monetizationMode: "ledger_gate",
      priceLabel: "$5/mo",
      permissionsSummary: {
        level: 2,
        slots: ["blog.header"],
        dataRead: ["blogposts"],
        egress: ["api.sunbird.ai"],
        sidecar: "personal",
      },
    });

    const inviteProject = daemon.db.createProject({
      ownerUid: "uid:kenneth",
      limbId: "beta-notes",
      name: "Beta Notes",
      mode: "salamanda-limb",
      baseTarget: "xkmato",
    });

    daemon.db.upsertGalleryListing({
      limbId: "beta-notes",
      projectId: inviteProject.id,
      authorUid: "uid:kenneth",
      title: "Beta Notes",
      description: "Invite-only sidebar notes.",
      baseTarget: "xkmato",
      publishedDigest: "sha256:def456",
      visibility: "public",
      monetizationMode: "allowlist",
      priceLabel: "Invite Only",
      permissionsSummary: {
        level: 1,
        slots: ["blog.sidebar"],
        dataRead: ["blogposts"],
        egress: [],
        sidecar: "personal",
      },
    });

    // 1. Gallery lists both public limbs with entitled=false for alice
    const listRes = await getGallery(
      new Request("http://localhost/api/v1/gallery?base=xkmato", {
        headers: { "x-newt-uid": "uid:alice" },
      })
    );
    const listBody = (await listRes.json()) as {
      listings: Array<{ limbId: string; entitled: boolean }>;
    };
    expect(listBody.listings).toHaveLength(2);
    expect(listBody.listings.every((l) => l.entitled === false)).toBe(true);

    // 2. Allowlist Limb blocks alice (402) until kenneth invites her
    const allowBlocked = await postInstallLimb(
      new Request("http://localhost/api/v1/gallery/beta-notes/install", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-newt-uid": "uid:alice" },
        body: JSON.stringify({ skipSalamandaBind: true }),
      }),
      { params: Promise.resolve({ limbId: "beta-notes" }) }
    );
    expect(allowBlocked.status).toBe(402);

    const grantRes = await postGrantEntitlement(
      new Request("http://localhost/api/v1/gallery/beta-notes/entitlements", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-newt-uid": "uid:kenneth" },
        body: JSON.stringify({ consumerUid: "uid:alice", grantSource: "author_invite" }),
      }),
      { params: Promise.resolve({ limbId: "beta-notes" }) }
    );
    expect(grantRes.status).toBe(201);

    const allowOk = await postInstallLimb(
      new Request("http://localhost/api/v1/gallery/beta-notes/install", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-newt-uid": "uid:alice" },
        body: JSON.stringify({ skipSalamandaBind: true }),
      }),
      { params: Promise.resolve({ limbId: "beta-notes" }) }
    );
    expect(allowOk.status).toBe(200);

    // 3. Pluggable external billing/ledger webhook for `ledger_gate`
    const WEBHOOK_SECRET = "xkmato-ledger-hmac-secret";
    let paidUsers = new Set<string>();
    let verifiedSignature = false;

    const webhookServer = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += String(c)));
      req.on("end", () => {
        const expectedSig = `sha256=${crypto.createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex")}`;
        verifiedSignature = req.headers["x-newt-signature"] === expectedSig;
        const parsed = JSON.parse(body) as { consumerUid: string };
        res.writeHead(200, { "Content-Type": "application/json" });
        if (paidUsers.has(parsed.consumerUid)) {
          res.end(JSON.stringify({ entitled: true, receiptId: "rcpt_xk_999" }));
        } else {
          res.end(
            JSON.stringify({
              entitled: false,
              reason: "Subscription required",
              checkoutUrl: "https://xkmato.com/subscribe/pro-luganda-tts",
            })
          );
        }
      });
    });

    await new Promise<void>((resolve) => webhookServer.listen(0, "127.0.0.1", () => resolve()));
    const port = (webhookServer.address() as { port: number }).port;
    process.env.NEWT_ENTITLEMENT_WEBHOOK_URL = `http://127.0.0.1:${port}/verify`;
    process.env.NEWT_ENTITLEMENT_WEBHOOK_SECRET = WEBHOOK_SECRET;

    try {
      // Unpaid consumer -> HTTP 402 with checkoutUrl
      const unpaidRes = await postInstallLimb(
        new Request("http://localhost/api/v1/gallery/pro-luganda-tts/install", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-newt-uid": "uid:alice" },
          body: JSON.stringify({ skipSalamandaBind: true }),
        }),
        { params: Promise.resolve({ limbId: "pro-luganda-tts" }) }
      );
      expect(unpaidRes.status).toBe(402);
      expect(verifiedSignature).toBe(true);
      const unpaidBody = (await unpaidRes.json()) as { checkoutUrl: string };
      expect(unpaidBody.checkoutUrl).toContain("xkmato.com");

      // Consumer pays -> webhook grants receipt -> now NEWT-CONSENT-001 (409) gates unapproved egress!
      paidUsers.add("uid:alice");
      const consentBlocked = await postInstallLimb(
        new Request("http://localhost/api/v1/gallery/pro-luganda-tts/install", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-newt-uid": "uid:alice" },
          body: JSON.stringify({ skipSalamandaBind: true, approvedEgressHosts: [] }),
        }),
        { params: Promise.resolve({ limbId: "pro-luganda-tts" }) }
      );
      expect(consentBlocked.status).toBe(409);

      // Consumer explicitly approves egress host -> HTTP 200 installed!
      const installedRes = await postInstallLimb(
        new Request("http://localhost/api/v1/gallery/pro-luganda-tts/install", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-newt-uid": "uid:alice" },
          body: JSON.stringify({
            skipSalamandaBind: true,
            approvedEgressHosts: ["api.sunbird.ai"],
          }),
        }),
        { params: Promise.resolve({ limbId: "pro-luganda-tts" }) }
      );
      expect(installedRes.status).toBe(200);
    } finally {
      await new Promise<void>((resolve) => webhookServer.close(() => resolve()));
    }
  });
});
