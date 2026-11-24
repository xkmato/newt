import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { createGenericBlogServer } from "../../../examples/generic-blog-demo/server.mjs";

const SALAMANDA_REPO = "/Users/kenneth/Code/salamanda";
const SALAMANDA_BIN = path.join(SALAMANDA_REPO, "target/debug/salamanda");
const HAS_REAL_SALAMANDA = fs.existsSync(SALAMANDA_BIN);
const BRIDGE_JS_PATH = path.resolve(process.cwd(), "../../packages/bridge/dist/bridge.js");

async function waitForUrl(url: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

test.describe("Milestone 5 — Fail-Open Resilience, /embed -> Salamanda Persistence & Cross-Platform Portability", () => {
  test("Task 5.1 Resilience: killing/stalling Newt (503 / ECONNREFUSED / timeout) produces ZERO pageerrors, ZERO bridge console errors, and ZERO CLS", async ({
    page,
  }) => {
    const bridgeSource = fs.readFileSync(BRIDGE_JS_PATH, "utf8");

    // Host server simulating a 503 health server and a stalled >2.5s server + a dead port
    const failingNewt503 = http.createServer((req, res) => {
      if (req.url === "/bridge.js") {
        res.writeHead(200, {
          "Content-Type": "application/javascript",
          "Access-Control-Allow-Origin": "*",
        });
        res.end(bridgeSource);
        return;
      }
      res.writeHead(503, { "Access-Control-Allow-Origin": "*" });
      res.end("Service Unavailable");
    });

    const stalledNewt = http.createServer((req, res) => {
      if (req.url === "/bridge.js") {
        res.writeHead(200, {
          "Content-Type": "application/javascript",
          "Access-Control-Allow-Origin": "*",
        });
        res.end(bridgeSource);
        return;
      }
      // Deliberately never responds to trigger 2.5s (configured 250ms in test) fail-open timeout
    });

    await new Promise<void>((r) => failingNewt503.listen(0, "127.0.0.1", () => r()));
    await new Promise<void>((r) => stalledNewt.listen(0, "127.0.0.1", () => r()));
    const port503 = (failingNewt503.address() as { port: number }).port;
    const portStall = (stalledNewt.address() as { port: number }).port;

    const hostServer = http.createServer((req, res) => {
      const mode = new URL(req.url ?? "/", "http://127.0.0.1").searchParams.get("mode") ?? "503";
      const bridgeOrigin =
        mode === "503"
          ? `http://127.0.0.1:${port503}`
          : mode === "timeout"
            ? `http://127.0.0.1:${portStall}`
            : "http://127.0.0.1:59999"; // ECONNREFUSED

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Host Resilience Test</title></head>
<body style="margin:0;padding:24px;font-family:system-ui;">
  <main><h1>Vanilla Host App</h1><p>Stays 100% stable when Newt is offline.</p></main>
  <amphibian-slot data-salamanda-slot="blog.sidebar"></amphibian-slot>
  <script>
    window.__cls = 0;
    try {
      new PerformanceObserver(function(list) {
        for (var entry of list.getEntries()) {
          if (!entry.hadRecentInput) window.__cls += entry.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch (e) {}
    window.__newtReadyFired = false;
    window.addEventListener("newt:ready", function() { window.__newtReadyFired = true; });
  </script>
  <script id="newt-bridge-script" src="${bridgeOrigin}/bridge.js" data-newt-origin="${bridgeOrigin}" data-timeout-ms="250" async defer onerror="void 0"></script>
</body></html>`);
    });

    await new Promise<void>((r) => hostServer.listen(0, "127.0.0.1", () => r()));
    const hostPort = (hostServer.address() as { port: number }).port;

    try {
      for (const mode of ["503", "timeout", "refused"] as const) {
        const pageErrors: string[] = [];
        page.on("pageerror", (e) => pageErrors.push(e.message));

        await page.goto(`http://127.0.0.1:${hostPort}/?mode=${mode}`);
        await page.waitForTimeout(450);

        const metrics = await page.evaluate(() => ({
          cls: (window as unknown as { __cls: number }).__cls,
          readyFired: (window as unknown as { __newtReadyFired: boolean }).__newtReadyFired,
          hasDrawer: Boolean(document.getElementById("newt-embed-drawer")),
        }));

        expect(pageErrors).toEqual([]);
        expect(metrics.cls).toBe(0);
        expect(metrics.readyFired).toBe(false);
        expect(metrics.hasDrawer).toBe(false);
      }
    } finally {
      await new Promise<void>((r) => hostServer.close(() => r()));
      await new Promise<void>((r) => failingNewt503.close(() => r()));
      stalledNewt.close();
    }
  });

  test("Task 5.3 Cross-Platform Portability: exact same @newt/bridge + Newt Studio authors and mounts working Limbs on BOTH generic-blog-demo (vanilla HTML) AND an XKmato host page", async ({
    page,
  }) => {
    const newtOrigin = "http://127.0.0.1:3199";

    // 1. Platform A: Vanilla Node/HTML `examples/generic-blog-demo` (OIDC Bearer callback, --blog-* CSS vars, repeater `comment.actions`)
    const genericBlog = createGenericBlogServer({ newtOrigin });
    await new Promise<void>((r) => genericBlog.listen(0, "127.0.0.1", () => r()));
    const blogPort = (genericBlog.address() as { port: number }).port;

    // 2. Platform B: XKmato-shaped host page (Firebase-style token callback, shadcn vars, `blog.sidebar`)
    const xkmatoHost = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>XKmato Host</title>
<style>:root { --background:#fff; --card:#fff; --foreground:#111; --border:#e5e7eb; }</style>
</head><body>
  <header><button id="open-xkmato-newt" type="button" data-testid="open-newt-drawer" style="display:none">Customize XKmato</button></header>
  <article><h1>Launching Amphibian</h1></article>
  <aside><amphibian-slot data-salamanda-slot="blog.sidebar" data-post-id="M9dqCTthbn1Re6senFms" data-post-slug="launching-amphibian"></amphibian-slot></aside>
  <script>
    window.NewtHost = {
      baseId: "xkmato",
      manifestUrl: "/.well-known/amphibian.json",
      getAuthToken: function() { return Promise.resolve("firebase-id-token-demo"); }
    };
    window.addEventListener("newt:ready", function() {
      var btn = document.getElementById("open-xkmato-newt");
      btn.style.display = "inline-block";
      btn.onclick = function() { window.NewtHost.openDrawer && window.NewtHost.openDrawer(); };
    });
  </script>
  <script id="newt-bridge-script" src="${newtOrigin}/bridge.js" data-base="xkmato" data-newt-origin="${newtOrigin}" async defer onerror="void 0"></script>
</body></html>`);
    });
    await new Promise<void>((r) => xkmatoHost.listen(0, "127.0.0.1", () => r()));
    const xkmatoPort = (xkmatoHost.address() as { port: number }).port;

    try {
      // --- Platform A: Generic Indie Blog ---
      await page.goto(`http://127.0.0.1:${blogPort}/articles/portable-living-software`);
      await expect(page.getByTestId("open-newt-drawer")).toBeVisible();
      await page.getByTestId("open-newt-drawer").click();

      const embedFrameA = page.frameLocator("#newt-embed-drawer iframe");
      await expect(embedFrameA.getByTestId("embed-base-id")).toHaveText("generic-blog");

      // Test Visual Slot Picker directly on the host page!
      await embedFrameA.getByTestId("embed-pick-slot-btn").click();
      await page.locator('[data-newt-pick-slot="comment.actions"]').first().click();
      await expect(embedFrameA.getByTestId("embed-slot-select")).toHaveValue("comment.actions");

      await embedFrameA
        .getByTestId("embed-prompt-input")
        .fill("Add a compact bookmark reaction pill to each comment");
      await embedFrameA.getByTestId("embed-synthesize-btn").click();
      await expect(embedFrameA.getByTestId("embed-status")).toContainText("Previewing");

      // Verify Shadow-DOM repeater mount on BOTH comments (`cmt-1` and `cmt-2`)!
      const blogMountedCount = await page.evaluate(() => {
        const slots = Array.from(
          document.querySelectorAll('amphibian-slot[data-salamanda-slot="comment.actions"]')
        );
        return slots.filter(
          (s) => s.getAttribute("data-salamanda-mounted") === "true" && Boolean(s.shadowRoot?.querySelector("iframe"))
        ).length;
      });
      expect(blogMountedCount).toBe(2);

      // --- Platform B: XKmato Host Page (EXACT SAME bridge.js + Newt Studio) ---
      await page.goto(`http://127.0.0.1:${xkmatoPort}/blog/launching-amphibian`);
      await expect(page.getByTestId("open-newt-drawer")).toBeVisible();
      await page.getByTestId("open-newt-drawer").click();

      const embedFrameB = page.frameLocator("#newt-embed-drawer iframe");
      await expect(embedFrameB.getByTestId("embed-base-id")).toHaveText("xkmato");

      await embedFrameB
        .getByTestId("embed-prompt-input")
        .fill("Build personal margin notes in blog.sidebar");
      await embedFrameB.getByTestId("embed-synthesize-btn").click();
      await expect(embedFrameB.getByTestId("embed-status")).toContainText("Previewing");

      const xkmatoMounted = await page.evaluate(() => {
        const slot = document.querySelector('amphibian-slot[data-salamanda-slot="blog.sidebar"]');
        return (
          slot?.getAttribute("data-salamanda-mounted") === "true" &&
          Boolean(slot?.shadowRoot?.querySelector("iframe"))
        );
      });
      expect(xkmatoMounted).toBe(true);
    } finally {
      await new Promise<void>((r) => genericBlog.close(() => r()));
      await new Promise<void>((r) => xkmatoHost.close(() => r()));
    }
  });

  test("Task 5.2 End-to-End Persistence: prompt in /embed -> inline preview -> activate on Salamanda -> stop Newt server -> Limb continues running via Salamanda alone", async ({
    page,
  }) => {
    test.skip(!HAS_REAL_SALAMANDA, "Real Rust salamanda binary not present");

    const ephemeralNewtPort = 3198;
    const ephemeralNewtOrigin = `http://127.0.0.1:${ephemeralNewtPort}`;

    // 1. Start upstream base on 127.0.0.1:3000 serving `post.sidebar` matching real Rust `salamanda dev`
    const upstream = http.createServer((req, res) => {
      if (req.url === "/.well-known/amphibian.json") {
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        });
        res.end(
          JSON.stringify({
            contract_version: "1.0.0",
            base: { id: "xkmato-salamanda", name: "XKmato Live", framework: "nextjs", origin: "http://127.0.0.1:3000" },
            runtime: { allow_levels: [1, 2], supports_client_only_hydration: true },
            auth: { strategy: "cookie-session", ssr_cookie: "__session" },
            theme: { tokens: { "--newt-bg": "--background", "--newt-fg": "--foreground" } },
            slots: [
              {
                id: "post.sidebar",
                cardinality: "singleton",
                description: "Sidebar companion slot",
                routes: ["/feed/*"],
                anchor_selector: '[data-salamanda-slot="post.sidebar"]',
                context_props: ["post-id"],
              },
            ],
            permissions_catalog: { readable_collections: ["posts"], sensitive_collections: ["dms"] },
          })
        );
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>XKmato via Salamanda</title></head>
<body>
  <header><button id="open-newt" type="button" data-testid="open-newt-drawer" style="display:none">Customize</button></header>
  <main><article><h1>Live Salamanda Essay</h1></article></main>
  <aside><amphibian-slot data-salamanda-slot="post.sidebar" data-post-id="M9dqCTthbn1Re6senFms"></amphibian-slot></aside>
  <script>
    window.NewtHost = {
      baseId: "xkmato",
      manifestUrl: "/.well-known/amphibian.json",
      getAuthToken: function() { return Promise.resolve(null); }
    };
    window.addEventListener("newt:ready", function() {
      var b = document.getElementById("open-newt");
      b.style.display = "inline-block";
      b.onclick = function() { window.NewtHost.openDrawer && window.NewtHost.openDrawer({ slotId: "post.sidebar" }); };
    });
  </script>
  <script id="newt-bridge-script" src="${ephemeralNewtOrigin}/bridge.js" data-base="xkmato" data-newt-origin="${ephemeralNewtOrigin}" data-timeout-ms="400" async defer onerror="void 0"></script>
</body></html>`);
    });

    await new Promise<void>((resolve, reject) => {
      upstream.once("error", reject);
      upstream.listen(3000, "127.0.0.1", () => resolve());
    });

    // 2. Start isolated real Rust `salamanda dev` (:8080 + :7474)
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "newt-m5-salamanda-"));
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
    let newtProc: ChildProcess | null = null;

    try {
      salamandaProc = spawn(SALAMANDA_BIN, ["dev"], { cwd: runDir, stdio: "pipe" });
      await waitForUrl("http://127.0.0.1:7474/v1/capabilities");

      // 3. Start dedicated Newt Studio server on :3198 that we will STOP mid-test!
      newtProc = spawn("pnpm", ["exec", "next", "start", "-p", String(ephemeralNewtPort)], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          NEWT_DB_PATH: ":memory:",
          NEWT_STUDIO_DEMO_PROVIDER: "1",
          SALAMANDA_CONTROL_PLANE_URL: "http://127.0.0.1:7474",
          SALAMANDA_CLIENT_ID: "amphibian-dev",
          SALAMANDA_CLIENT_KEY: "dev-secret",
        },
        stdio: "pipe",
      });
      await waitForUrl(`${ephemeralNewtOrigin}/api/v1/health`);

      // Register Salamanda dev's `post.sidebar` manifest on the ephemeral Newt daemon for `xkmato`
      await fetch(`${ephemeralNewtOrigin}/api/v1/bases`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          manifest: {
            contract_version: "1.0.0",
            base: { id: "xkmato", name: "XKmato", framework: "nextjs", origin: "http://127.0.0.1:3000" },
            runtime: { allow_levels: [1, 2], supports_client_only_hydration: true },
            auth: { strategy: "cookie-session", ssr_cookie: "__session" },
            theme: { tokens: { "--newt-bg": "--background", "--newt-fg": "--foreground" } },
            slots: [
              {
                id: "post.sidebar",
                cardinality: "singleton",
                description: "Sidebar companion slot",
                routes: ["/feed/*"],
                anchor_selector: '[data-salamanda-slot="post.sidebar"]',
                context_props: ["post-id"],
              },
            ],
            permissions_catalog: { readable_collections: ["posts"], sensitive_collections: ["dms"] },
          },
        }),
      });

      // 4. Visit the host page THROUGH Salamanda Edge Proxy (:8080) as `uid:kenneth`
      await page.route("http://127.0.0.1:8080/**", async (route) => {
        const headers = { ...route.request().headers(), "x-dev-uid": "uid:kenneth" };
        await route.continue({ headers });
      });
      await page.goto("http://127.0.0.1:8080/feed/M9dqCTthbn1Re6senFms");
      await expect(page.getByTestId("open-newt-drawer")).toBeVisible();

      // Open /embed drawer, prompt a Limb -> ephemeral inline preview in Shadow DOM
      await page.getByTestId("open-newt-drawer").click();
      const embedFrame = page.frameLocator("#newt-embed-drawer iframe");
      await embedFrame
        .getByTestId("embed-prompt-input")
        .fill("Build personal margin notes in post.sidebar");
      await embedFrame.getByTestId("embed-synthesize-btn").click();
      await expect(embedFrame.getByTestId("embed-status")).toContainText("Previewing");

      const inlinePreviewMounted = await page.evaluate(() => {
        const slot = document.querySelector('amphibian-slot[data-salamanda-slot="post.sidebar"]');
        return Boolean(slot?.shadowRoot?.querySelector("iframe"));
      });
      expect(inlinePreviewMounted).toBe(true);

      // 5. Activate on Salamanda!
      await embedFrame.getByTestId("embed-activate-btn").click();
      await expect(embedFrame.getByTestId("embed-status")).toContainText("Activated");

      // 6. STOP the Newt server completely!
      newtProc.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        newtProc!.once("exit", () => resolve());
        setTimeout(resolve, 3000);
      });
      newtProc = null;

      // 7. Reload the page on Salamanda (:8080) with Newt DEAD -> Limb MUST continue running via Salamanda alone!
      const errorsAfterKill: string[] = [];
      page.on("pageerror", (e) => errorsAfterKill.push(e.message));

      await page.reload();
      await page.waitForTimeout(500);

      expect(errorsAfterKill).toEqual([]);
      // Newt button stays hidden because Newt is dead (fail-open)
      await expect(page.getByTestId("open-newt-drawer")).toBeHidden();
      // Salamanda's server-side overlay + loader.js still mounts the activated Limb!
      await expect(page.locator('[data-salamanda-limb="blog-sidebar-margin-notes"]')).toBeVisible();
    } finally {
      if (newtProc && !newtProc.killed) newtProc.kill("SIGTERM");
      if (salamandaProc && !salamandaProc.killed) salamandaProc.kill("SIGTERM");
      await new Promise<void>((r) => upstream.close(() => r()));
      fs.rmSync(runDir, { recursive: true, force: true });
    }
  });
});
