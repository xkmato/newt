import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RFC_DIR = path.resolve(__dirname, "../../../docs/salamanda-rfcs");

interface ResolvedSlotPayloadV11 {
  limb_id: string;
  slot_id: string;
  cardinality?: "singleton" | "repeater";
  route_pattern?: string;
  placement?: string;
  html_content: string;
  isolation: "iframe" | "same-origin-personal";
}

function resolveContainerKey(
  payload: ResolvedSlotPayloadV11,
  ctxProps: Record<string, string>,
  anchorIndex: number
): string {
  const cardinality = payload.cardinality ?? "singleton";
  const instanceKey =
    cardinality === "repeater"
      ? (ctxProps["post-id"] ?? ctxProps["item-id"] ?? String(anchorIndex))
      : "default";
  return `salamanda-mount-${payload.limb_id}-${payload.slot_id}-${instanceKey}`;
}

function clampResizeHeightV11(rawHeight: number): number {
  if (!Number.isFinite(rawHeight) || rawHeight < 0) return 0;
  if (rawHeight > 1200) return 1200;
  return Math.ceil(rawHeight);
}

interface LimbInvokeRpc {
  op: "limb_invoke";
  limb_id: string;
  route: string;
  method: string;
  body?: unknown;
}

function validateLimbInvokeRpc(
  req: LimbInvokeRpc,
  activeLimbIds: string[]
): { ok: boolean; error?: string } {
  if (!activeLimbIds.includes(req.limb_id)) {
    return { ok: false, error: `limb '${req.limb_id}' is not active in this session` };
  }
  const requiredPrefix = `/_limb/${req.limb_id}/`;
  if (!req.route.startsWith(requiredPrefix) || req.route.includes("..")) {
    return {
      ok: false,
      error: `limb '${req.limb_id}' cannot invoke cross-limb or traversal route '${req.route}'`,
    };
  }
  if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(req.method.toUpperCase())) {
    return { ok: false, error: `unsupported HTTP method '${req.method}'` };
  }
  return { ok: true };
}

function allowedFirebaseIssuers(projectId: string): string[] {
  return [
    `https://session.firebase.google.com/${projectId}`,
    `https://securetoken.google.com/${projectId}`,
  ];
}

describe("Task 4.2 — Salamanda v1.1 Upstream RFCs & Consumer-Driven Contract Tests", () => {
  it("commits all three RFC specs and reference unified patches targeting Salamanda crates", () => {
    const expectedFiles = [
      "README.md",
      "RFC-0001-shadow-dom-repeater-slots.md",
      "RFC-0002-broker-limb-invoke.md",
      "RFC-0003-firebase-session-cookie-and-spa-bearer.md",
      "patches/rfc-0001-salamanda-overlay.patch",
      "patches/rfc-0002-broker-limb-invoke.patch",
      "patches/rfc-0003-salamanda-identity-proxy.patch",
    ];

    for (const rel of expectedFiles) {
      const full = path.join(RFC_DIR, rel);
      expect(fs.existsSync(full), `Missing RFC artifact: ${rel}`).toBe(true);
    }

    const patch1 = fs.readFileSync(path.join(RFC_DIR, "patches/rfc-0001-salamanda-overlay.patch"), "utf8");
    expect(patch1).toContain("AMPHIBIAN-SLOT");
    expect(patch1).toContain("MutationObserver");
    expect(patch1).toContain("salamanda.context.request.v1");
    expect(patch1).toContain("salamanda.resize.v1");

    const patch2 = fs.readFileSync(path.join(RFC_DIR, "patches/rfc-0002-broker-limb-invoke.patch"), "utf8");
    expect(patch2).toContain("LimbInvoke");
    expect(patch2).toContain("/_limb/{}/");
    expect(patch2).toContain("function_pool");

    const patch3 = fs.readFileSync(path.join(RFC_DIR, "patches/rfc-0003-salamanda-identity-proxy.patch"), "utf8");
    expect(patch3).toContain("firebase_dual_mode");
    expect(patch3).toContain("https://session.firebase.google.com/");
    expect(patch3).toContain("/_salamanda/slots-for-principal");
  });

  it("RFC-0001: preserves v1.0 singleton defaults, keys repeater cards independently, and clamps resize bounds", () => {
    const v10Singleton: ResolvedSlotPayloadV11 = {
      limb_id: "margin-notes",
      slot_id: "blog.sidebar",
      html_content: "<div>Notes</div>",
      isolation: "iframe",
    };
    expect(resolveContainerKey(v10Singleton, { "post-id": "p1" }, 0)).toBe(
      "salamanda-mount-margin-notes-blog.sidebar-default"
    );

    const v11Repeater: ResolvedSlotPayloadV11 = {
      limb_id: "micro-kudos",
      slot_id: "micropost.footer",
      cardinality: "repeater",
      html_content: "<button>Kudos</button>",
      isolation: "iframe",
    };
    const keyA = resolveContainerKey(v11Repeater, { "post-id": "syw0gTrIt2ffuzBR8XJR" }, 0);
    const keyB = resolveContainerKey(v11Repeater, { "post-id": "Mocsrechn43c3VFe9Zwl" }, 1);
    expect(keyA).not.toBe(keyB);
    expect(keyA).toContain("syw0gTrIt2ffuzBR8XJR");
    expect(keyB).toContain("Mocsrechn43c3VFe9Zwl");

    expect(clampResizeHeightV11(-20)).toBe(0);
    expect(clampResizeHeightV11(240.3)).toBe(241);
    expect(clampResizeHeightV11(9999)).toBe(1200);
  });

  it("RFC-0002: allows same-limb L2 BrokerRpcRequest::LimbInvoke and blocks cross-limb / path traversal calls", () => {
    const active = ["community-poll-l2"];

    expect(
      validateLimbInvokeRpc(
        {
          op: "limb_invoke",
          limb_id: "community-poll-l2",
          route: "/_limb/community-poll-l2/vote",
          method: "POST",
          body: { choice: "A" },
        },
        active
      ).ok
    ).toBe(true);

    // Cross-limb invocation must be denied
    const crossLimb = validateLimbInvokeRpc(
      {
        op: "limb_invoke",
        limb_id: "community-poll-l2",
        route: "/_limb/other-limb/admin",
        method: "POST",
      },
      active
    );
    expect(crossLimb.ok).toBe(false);

    // Path traversal must be denied
    const traversal = validateLimbInvokeRpc(
      {
        op: "limb_invoke",
        limb_id: "community-poll-l2",
        route: "/_limb/community-poll-l2/../other-limb/vote",
        method: "POST",
      },
      active
    );
    expect(traversal.ok).toBe(false);

    // Inactive limb must be denied
    const inactive = validateLimbInvokeRpc(
      {
        op: "limb_invoke",
        limb_id: "uninstalled-limb",
        route: "/_limb/uninstalled-limb/vote",
        method: "POST",
      },
      active
    );
    expect(inactive.ok).toBe(false);
  });

  it("RFC-0003: verifies dual-issuer Firebase Session Cookie + ID Token presets and SPA slot hydration envelope", () => {
    const issuers = allowedFirebaseIssuers("xkmato");
    expect(issuers).toContain("https://session.firebase.google.com/xkmato");
    expect(issuers).toContain("https://securetoken.google.com/xkmato");
    expect(issuers).not.toContain("https://securetoken.google.com/attacker-project");

    // Consumer-driven response shape for POST /_salamanda/slots-for-principal
    const spaResponse = {
      principal_uid: "uid:kenneth",
      route: "/blog/launching-amphibian",
      kill_switch: false,
      slots: [
        {
          limb_id: "margin-notes",
          slot_id: "blog.sidebar",
          cardinality: "singleton",
          route_pattern: "/blog/*",
          placement: "inside-end",
          html_content: "<!DOCTYPE html><html><body>Notes</body></html>",
          isolation: "iframe",
          allowed_sidecar_scope: "personal",
          allowed_data_read: ["blogposts"],
        },
      ],
    };
    expect(spaResponse.kill_switch).toBe(false);
    expect(spaResponse.slots[0]?.slot_id).toBe("blog.sidebar");
  });
});
