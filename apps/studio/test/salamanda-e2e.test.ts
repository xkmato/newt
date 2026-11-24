import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AmphibianPlatformManifest } from "@newt/base-sdk";
import { POST as postProject } from "../app/api/v1/projects/route";
import { POST as postDeploy } from "../app/api/v1/projects/[id]/deploy/route";
import { POST as postPublish } from "../app/api/v1/projects/[id]/publish/route";
import {
  DELETE as deleteBindingsMe,
  GET as getBindingsMe,
  PUT as putBindingsMe,
} from "../app/api/v1/bindings/me/route";
import { setStudioDaemonForTesting, StudioDaemon } from "../src/server/daemon";

const SALAMANDA_REPO = "/Users/kenneth/Code/salamanda";
const SALAMANDA_BIN = path.join(SALAMANDA_REPO, "target/debug/salamanda");
const HAS_REAL_SALAMANDA = fs.existsSync(SALAMANDA_BIN);

const SALAMANDA_DEV_MANIFEST: AmphibianPlatformManifest = {
  contract_version: "1.0.0",
  base: {
    id: "xkmato",
    name: "XKmato (Salamanda Dev)",
    framework: "nextjs",
    origin: "http://127.0.0.1:3000",
  },
  runtime: { allow_levels: [1, 2], supports_client_only_hydration: true },
  auth: { strategy: "cookie-session", ssr_cookie: "__session" },
  theme: {
    dark_mode_selector: "html.dark",
    tokens: {
      "--newt-bg": "--background",
      "--newt-card": "--card",
      "--newt-fg": "--foreground",
      "--newt-border": "--border",
    },
  },
  slots: [
    {
      id: "post.header",
      cardinality: "singleton",
      description: "Above essay body",
      routes: ["/post/*", "/feed/*"],
      anchor_selector: '[data-salamanda-slot="post.header"]',
      context_props: ["post-id", "author-id", "lang"],
    },
    {
      id: "post.sidebar",
      cardinality: "singleton",
      description: "Sidebar companion slot",
      routes: ["/post/*", "/feed/*"],
      anchor_selector: '[data-salamanda-slot="post.sidebar"]',
      context_props: ["post-id"],
    },
    {
      id: "feed.footer",
      cardinality: "singleton",
      description: "Footer below feed",
      routes: ["/", "/feed"],
      anchor_selector: '[data-salamanda-slot="feed.footer"]',
      context_props: [],
    },
  ],
  permissions_catalog: {
    readable_collections: ["posts", "comments", "users:public"],
    sensitive_collections: ["dms", "payments", "users:private", "admin"],
  },
};

async function waitForUrl(url: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

describe("Task 4.1 — Salamanda ClientDelegationAuth Deployment Pipeline", () => {
  let daemon: StudioDaemon;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv.SALAMANDA_CONTROL_PLANE_URL = process.env.SALAMANDA_CONTROL_PLANE_URL;
    savedEnv.SALAMANDA_CLIENT_ID = process.env.SALAMANDA_CLIENT_ID;
    savedEnv.SALAMANDA_CLIENT_KEY = process.env.SALAMANDA_CLIENT_KEY;

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

  it("enforces NEWT-CONSENT-001 Human Egress Consent gate (HTTP 409) before mutating Salamanda and injects server-held client credentials", async () => {
    let upsertCalls = 0;
    let receivedClientId = "";
    let receivedClientKey = "";
    let receivedDevUid = "";

    const mockCp = http.createServer((req, res) => {
      let rawBody = "";
      req.on("data", (c) => (rawBody += String(c)));
      req.on("end", () => {
        if (req.method === "POST" && req.url === "/v1/limbs") {
          upsertCalls++;
          receivedClientId = String(req.headers["x-salamanda-client-id"] ?? "");
          receivedClientKey = String(req.headers["x-salamanda-client-key"] ?? "");
          receivedDevUid = String(req.headers["x-dev-uid"] ?? "");
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ limb_id: "egress-tts-limb", version: "0.1.0", status: "draft" }));
          return;
        }
        if (req.method === "GET" && req.url?.includes("/bindings")) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ principal_uid: "uid:kenneth", limbs: [] }));
          return;
        }
        if (req.method === "PUT" && req.url?.includes("/bindings")) {
          const parsed = JSON.parse(rawBody) as { limbs: string[] };
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ principal_uid: "uid:kenneth", limbs: parsed.limbs }));
          return;
        }
        res.writeHead(404);
        res.end("not found");
      });
    });

    await new Promise<void>((resolve) => mockCp.listen(0, "127.0.0.1", () => resolve()));
    const addr = mockCp.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;

    process.env.SALAMANDA_CONTROL_PLANE_URL = `http://127.0.0.1:${port}`;
    process.env.SALAMANDA_CLIENT_ID = "newt-server-client";
    process.env.SALAMANDA_CLIENT_KEY = "super-secret-server-key";

    try {
      const createRes = await postProject(
        new Request("http://localhost/api/v1/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-newt-uid": "uid:kenneth" },
          body: JSON.stringify({
            name: "Egress TTS Limb",
            mode: "salamanda-limb",
            baseTarget: "xkmato",
            limbId: "egress-tts-limb",
            initialFiles: {
              "limb.toml": `
[limb]
id = "egress-tts-limb"
name = "Egress TTS Limb"
version = "0.1.0"
level = 2
author = "uid:kenneth"

[requires]
contract = ">=1.0"
base = "xkmato"
slots = ["blog.header"]

[[ui]]
slot = "blog.header"
route_pattern = "/blog/*"
component = "ui/Tts.html"
isolation = "iframe"

[permissions]
data_read = ["blogposts"]
data_write = []
egress = ["api.sunbird.ai"]
sidecar = "none"
`,
              "src/ui/Tts.tsx": `
export default function Tts() {
  return <button type="button">Speak Luganda</button>;
}
`,
            },
          }),
        })
      );
      expect(createRes.status).toBe(201);
      const { project } = (await createRes.json()) as { project: { id: string } };

      // 1. Deploy WITHOUT human egress consent -> blocked with HTTP 409 NEWT-CONSENT-001 (0 calls to Salamanda!)
      const blockedRes = await postDeploy(
        new Request(`http://localhost/api/v1/projects/${project.id}/deploy`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-newt-uid": "uid:kenneth" },
          body: JSON.stringify({ approvedEgressHosts: [] }),
        }),
        { params: Promise.resolve({ id: project.id }) }
      );
      expect(blockedRes.status).toBe(409);
      const blockedBody = (await blockedRes.json()) as {
        code: string;
        requiresEgressConsent: boolean;
        unapprovedEgressHosts: string[];
      };
      expect(blockedBody.code).toBe("NEWT-CONSENT-001");
      expect(blockedBody.requiresEgressConsent).toBe(true);
      expect(blockedBody.unapprovedEgressHosts).toEqual(["api.sunbird.ai"]);
      expect(upsertCalls).toBe(0);

      // 2. Deploy WITH explicit human consent -> succeeds with server-held client credentials
      const okRes = await postDeploy(
        new Request(`http://localhost/api/v1/projects/${project.id}/deploy`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-newt-uid": "uid:kenneth" },
          body: JSON.stringify({ approvedEgressHosts: ["api.sunbird.ai"] }),
        }),
        { params: Promise.resolve({ id: project.id }) }
      );
      expect(okRes.status).toBe(200);
      expect(upsertCalls).toBe(1);
      expect(receivedClientId).toBe("newt-server-client");
      expect(receivedClientKey).toBe("super-secret-server-key");
      expect(receivedDevUid).toBe("uid:kenneth");
    } finally {
      await new Promise<void>((resolve) => mockCp.close(() => resolve()));
    }
  });

  it.skipIf(!HAS_REAL_SALAMANDA)(
    "E2E against real Rust salamanda daemon (:8080 + :7474): compiles, uploads, binds for uid:kenneth while uid:alice stays on vanilla fast path, publishes, and detaches",
    async () => {
      // 1. Start mock upstream base on 127.0.0.1:3000 (matching salamanda dev's mock-base-next upstream)
      const VANILLA_HTML =
        '<!DOCTYPE html><html><body><div data-salamanda-slot="post.header"></div><aside data-salamanda-slot="post.sidebar" data-post-id="M9dqCTthbn1Re6senFms"></aside><main><article>Vanilla XKMato Essay</article></main></body></html>';

      const upstream = http.createServer((req, res) => {
        if (req.url === "/feed/M9dqCTthbn1Re6senFms") {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(VANILLA_HTML);
          return;
        }
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("ok");
      });

      await new Promise<void>((resolve, reject) => {
        upstream.once("error", reject);
        upstream.listen(3000, "127.0.0.1", () => resolve());
      });

      // 2. Prepare isolated working directory for real Rust `salamanda dev`
      const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "newt-salamanda-e2e-"));
      const mockBaseDir = path.join(runDir, "examples/mock-base-next");
      fs.mkdirSync(mockBaseDir, { recursive: true });
      fs.copyFileSync(
        path.join(SALAMANDA_REPO, "examples/mock-base-next/salamanda.toml"),
        path.join(mockBaseDir, "salamanda.toml")
      );
      fs.copyFileSync(
        path.join(SALAMANDA_REPO, "examples/mock-base-next/slots.json"),
        path.join(mockBaseDir, "slots.json")
      );

      let salamandaProc: ChildProcess | null = null;

      try {
        salamandaProc = spawn(SALAMANDA_BIN, ["dev"], {
          cwd: runDir,
          stdio: "pipe",
        });

        await waitForUrl("http://127.0.0.1:7474/v1/capabilities", 10_000);

        process.env.SALAMANDA_CONTROL_PLANE_URL = "http://127.0.0.1:7474";
        process.env.SALAMANDA_CLIENT_ID = "amphibian-dev";
        process.env.SALAMANDA_CLIENT_KEY = "dev-secret";

        // Register salamanda dev's base manifest (`post.sidebar` / `post.header` / `feed.footer`)
        daemon.bases.registerManifest(SALAMANDA_DEV_MANIFEST);

        // 3. Create a Newt project compiling Preact TSX into a self-contained srcdoc Limb
        const createRes = await postProject(
          new Request("http://localhost/api/v1/projects", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-newt-uid": "uid:kenneth" },
            body: JSON.stringify({
              name: "Live Sidebar Companion",
              mode: "salamanda-limb",
              baseTarget: "xkmato",
              limbId: "live-sidebar-companion",
              initialFiles: {
                "limb.toml": `
[limb]
id = "live-sidebar-companion"
name = "Live Sidebar Companion"
version = "0.1.0"
level = 1
author = "uid:studio"
description = "Compiled by Newt and deployed live to Rust Salamanda"

[requires]
contract = ">=1.0"
base = "xkmato"
slots = ["post.sidebar"]

[[ui]]
slot = "post.sidebar"
route_pattern = "/feed/*"
component = "ui/Companion.html"
isolation = "iframe"

[permissions]
data_read = ["posts"]
data_write = []
egress = []
sidecar = "none"
`,
                "src/ui/Companion.tsx": `
import { useSlotContext } from "@newt/ui-sdk";
export default function Companion() {
  const ctx = useSlotContext();
  return <section>Live Newt Companion for {ctx.props["post-id"] ?? "essay"}</section>;
}
`,
              },
            }),
          })
        );
        expect(createRes.status).toBe(201);
        const { project, compiled } = (await createRes.json()) as {
          project: { id: string };
          compiled: { valid: boolean };
        };
        expect(compiled.valid).toBe(true);

        // 4. Deploy & bind for `uid:kenneth` through Newt's `/api/v1/projects/:id/deploy`
        const deployRes = await postDeploy(
          new Request(`http://localhost/api/v1/projects/${project.id}/deploy`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-newt-uid": "uid:kenneth" },
            body: JSON.stringify({ bindToSelf: true }),
          }),
          { params: Promise.resolve({ id: project.id }) }
        );
        expect(deployRes.status).toBe(200);
        const deployed = (await deployRes.json()) as {
          deployed: boolean;
          limbId: string;
          bindings: string[];
        };
        expect(deployed.deployed).toBe(true);
        expect(deployed.limbId).toBe("live-sidebar-companion");
        expect(deployed.bindings).toContain("live-sidebar-companion");

        // 5. Verify via real Rust Salamanda Edge Proxy (:8080):
        //    - `uid:kenneth` gets the compiled Limb overlay + private no-store cache headers
        const kennethResp = await fetch("http://127.0.0.1:8080/feed/M9dqCTthbn1Re6senFms", {
          headers: { "x-dev-uid": "uid:kenneth" },
        });
        expect(kennethResp.status).toBe(200);
        expect(kennethResp.headers.get("cache-control")).toBe("private, no-store");
        const kennethHtml = await kennethResp.text();
        expect(kennethHtml).toContain("salamanda-mount-live-sidebar-companion-post.sidebar");
        expect(kennethHtml).toContain("/_salamanda/loader.js");
        expect(kennethHtml).toContain("Live Newt Companion");

        //    - `uid:alice` stays on the VANILLA FAST PATH (zero Limb injection!)
        const aliceResp = await fetch("http://127.0.0.1:8080/feed/M9dqCTthbn1Re6senFms", {
          headers: { "x-dev-uid": "uid:alice" },
        });
        expect(aliceResp.status).toBe(200);
        const aliceHtml = await aliceResp.text();
        expect(aliceHtml).toBe(VANILLA_HTML);
        expect(aliceHtml).not.toContain("salamanda-mount-live-sidebar-companion");

        // 6. Publish immutable digest via `/api/v1/projects/:id/publish`
        const pubRes = await postPublish(
          new Request(`http://localhost/api/v1/projects/${project.id}/publish`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-newt-uid": "uid:kenneth" },
            body: JSON.stringify({ visibility: "public", monetizationMode: "free" }),
          }),
          { params: Promise.resolve({ id: project.id }) }
        );
        expect(pubRes.status).toBe(200);
        const published = (await pubRes.json()) as {
          published: boolean;
          publishedDigest: string;
          listing: { limbId: string; publishedDigest: string };
        };
        expect(published.published).toBe(true);
        expect(published.publishedDigest.length).toBeGreaterThan(8);
        expect(published.listing.limbId).toBe("live-sidebar-companion");

        // 7. Verify `/api/v1/bindings/me` GET, PUT, and DELETE (instant revert to vanilla)
        const getBindRes = await getBindingsMe(
          new Request("http://localhost/api/v1/bindings/me", {
            headers: { "x-newt-uid": "uid:kenneth" },
          })
        );
        expect(((await getBindRes.json()) as { limbs: string[] }).limbs).toEqual([
          "live-sidebar-companion",
        ]);

        // Alice can bind the published Limb via PUT /api/v1/bindings/me
        const aliceBindRes = await putBindingsMe(
          new Request("http://localhost/api/v1/bindings/me", {
            method: "PUT",
            headers: { "Content-Type": "application/json", "x-newt-uid": "uid:alice" },
            body: JSON.stringify({ limbs: ["live-sidebar-companion"] }),
          })
        );
        expect(aliceBindRes.status).toBe(200);
        const aliceAfterBind = await (
          await fetch("http://127.0.0.1:8080/feed/M9dqCTthbn1Re6senFms", {
            headers: { "x-dev-uid": "uid:alice" },
          })
        ).text();
        expect(aliceAfterBind).toContain("salamanda-mount-live-sidebar-companion-post.sidebar");

        // Kenneth detaches via DELETE /api/v1/bindings/me -> immediately reverts to vanilla fast path
        const detachRes = await deleteBindingsMe(
          new Request("http://localhost/api/v1/bindings/me", {
            method: "DELETE",
            headers: { "x-newt-uid": "uid:kenneth" },
          })
        );
        expect(detachRes.status).toBe(200);

        const kennethAfterDetach = await (
          await fetch("http://127.0.0.1:8080/feed/M9dqCTthbn1Re6senFms", {
            headers: { "x-dev-uid": "uid:kenneth" },
          })
        ).text();
        expect(kennethAfterDetach).toBe(VANILLA_HTML);
      } finally {
        if (salamandaProc && !salamandaProc.killed) {
          salamandaProc.kill("SIGTERM");
        }
        await new Promise<void>((resolve) => upstream.close(() => resolve()));
        fs.rmSync(runDir, { recursive: true, force: true });
      }
    },
    30_000
  );
});
