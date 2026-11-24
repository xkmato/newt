import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it } from "vitest";
import { clampHeight, computeSlotInstanceKey, initNewtBridge } from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("Task 5.1 — @newt/bridge (<4 KB gzipped, fail-open, Shadow DOM & repeaters)", () => {
  const originalGlobals: Record<string, unknown> = {};

  function installDom(html: string): JSDOM {
    const dom = new JSDOM(html, { url: "https://host.example/feed" });
    for (const key of [
      "window",
      "document",
      "location",
      "HTMLElement",
      "ShadowRoot",
      "CustomEvent",
      "MutationObserver",
      "getComputedStyle",
      "MessageChannel",
    ]) {
      originalGlobals[key] = (globalThis as Record<string, unknown>)[key];
      (globalThis as Record<string, unknown>)[key] = (
        dom.window as unknown as Record<string, unknown>
      )[key];
    }
    return dom;
  }

  afterEach(() => {
    for (const [key, val] of Object.entries(originalGlobals)) {
      if (val === undefined) {
        delete (globalThis as Record<string, unknown>)[key];
      } else {
        (globalThis as Record<string, unknown>)[key] = val;
      }
    }
  });

  it("ships dist/bridge.js strictly under 4 KB gzipped with zero Firebase coupling", () => {
    const distPath = path.resolve(__dirname, "../dist/bridge.js");
    expect(fs.existsSync(distPath)).toBe(true);
    const raw = fs.readFileSync(distPath);
    const gz = zlib.gzipSync(raw, { level: 9 });
    expect(gz.byteLength).toBeLessThan(4096);
    expect(raw.toString("utf8").toLowerCase()).not.toContain("firebase");
  });

  it("fails open silently with zero errors or DOM changes on 503, ECONNREFUSED, and timeout", async () => {
    installDom('<!DOCTYPE html><html><body><amphibian-slot data-salamanda-slot="blog.sidebar"></amphibian-slot></body></html>');
    const readyEvents: Event[] = [];
    window.addEventListener("newt:ready", (e) => readyEvents.push(e));

    // 1. 503 Service Unavailable
    const h503 = await initNewtBridge({
      newtOrigin: "http://127.0.0.1:3100",
      fetchImpl: (async () => new Response("down", { status: 503 })) as typeof fetch,
    });
    expect(h503.ready).toBe(false);

    // 2. Network / ECONNREFUSED failure
    const hErr = await initNewtBridge({
      newtOrigin: "http://127.0.0.1:3100",
      fetchImpl: (async () => {
        throw new Error("ECONNREFUSED");
      }) as typeof fetch,
    });
    expect(hErr.ready).toBe(false);

    // 3. Stalled response aborted by timeoutMs
    const hTimeout = await initNewtBridge({
      newtOrigin: "http://127.0.0.1:3100",
      timeoutMs: 40,
      fetchImpl: ((_url: unknown, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        })) as typeof fetch,
    });
    expect(hTimeout.ready).toBe(false);
    expect(readyEvents).toHaveLength(0);
    expect(window.NewtHost?.openDrawer).toBeUndefined();
    expect(document.querySelector("dialog")).toBeNull();
  });

  it("mounts into <amphibian-slot> Shadow DOM, hydrates dynamically appended repeater cards via MutationObserver, and clamps heights", async () => {
    installDom(
      '<!DOCTYPE html><html><body><div id="feed"><amphibian-slot data-salamanda-slot="micropost.footer" data-post-id="p1"></amphibian-slot></div></body></html>'
    );

    const readyEvents: Event[] = [];
    window.addEventListener("newt:ready", (e) => readyEvents.push(e));

    const handle = await initNewtBridge({
      newtOrigin: "http://127.0.0.1:3100",
      baseId: "xkmato",
      fetchImpl: (async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as typeof fetch,
    });

    try {
      expect(handle.ready).toBe(true);
      expect(readyEvents).toHaveLength(1);
      expect(typeof window.NewtHost?.openDrawer).toBe("function");

      handle.previewInline({
        slotId: "micropost.footer",
        limbId: "kudos-bar",
        compiledHtml: "<!DOCTYPE html><html><body><button>Kudos</button></body></html>",
        cardinality: "repeater",
      });

      const firstSlot = document.querySelector('[data-post-id="p1"]')!;
      expect(firstSlot.getAttribute("data-salamanda-mounted")).toBe("true");
      expect(firstSlot.shadowRoot?.querySelector("iframe")?.getAttribute("sandbox")).toBe(
        "allow-scripts allow-forms"
      );

      // Dynamically append a second card (infinite scroll simulation)
      const secondSlot = document.createElement("amphibian-slot");
      secondSlot.setAttribute("data-salamanda-slot", "micropost.footer");
      secondSlot.setAttribute("data-post-id", "p2");
      document.getElementById("feed")!.appendChild(secondSlot);

      await new Promise((r) => setTimeout(r, 40));
      expect(secondSlot.getAttribute("data-salamanda-mounted")).toBe("true");
      expect(secondSlot.shadowRoot?.querySelector("iframe")).not.toBeNull();

      // Slot picker creates interactive overlay button for each slot
      handle.enterSlotPicker();
      expect(document.querySelectorAll("[data-newt-pick-slot='micropost.footer']").length).toBe(2);
      handle.exitSlotPicker();
      expect(document.getElementById("newt-slot-picker-overlay")).toBeNull();

      expect(computeSlotInstanceKey({ "post-id": "abc" }, "repeater", 0)).toBe("abc");
      expect(computeSlotInstanceKey({ "post-id": "abc" }, "singleton", 0)).toBe("default");
      expect(clampHeight(2500)).toBe(1200);
      expect(clampHeight(-5)).toBe(0);
    } finally {
      handle.destroy();
    }
  });
});
