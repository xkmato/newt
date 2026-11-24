import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import esbuild from "esbuild";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import {
  clampResizeHeight,
  executeSidecar,
  invokeLimbFunction,
  querySidecar,
  readCanonical,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("@newt/ui-sdk size budget & RPC correlation", () => {
  it("stays strictly under the 3 KB (3072 bytes) gzipped size budget", async () => {
    const entry = path.resolve(__dirname, "../src/index.ts");
    const bundled = await esbuild.build({
      entryPoints: [entry],
      bundle: true,
      minify: true,
      format: "esm",
      external: ["preact", "preact/hooks"],
      write: false,
    });
    const rawCode = bundled.outputFiles[0]?.contents ?? new Uint8Array();
    const gzipped = gzipSync(rawCode);
    expect(gzipped.byteLength).toBeLessThan(3072);
  });

  it("clamps iframe auto-resize heights to [0, 1200] against UI griefing", () => {
    expect(clampResizeHeight(-40)).toBe(0);
    expect(clampResizeHeight(NaN)).toBe(0);
    expect(clampResizeHeight(184.2)).toBe(185);
    expect(clampResizeHeight(99999)).toBe(1200);
  });

  it("correlates concurrent postMessage broker RPCs, propagates errors, and times out cleanly", async () => {
    const dom = new JSDOM("<!DOCTYPE html><html><body><div id='root'></div></body></html>", {
      url: "https://null.example/",
    });
    const prevWindow = globalThis.window;
    const prevDocument = globalThis.document;
    // @ts-expect-error attach JSDOM globals for RPC test
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;

    try {
      dom.window.__NEWT_BOOT__ = {
        limbId: "reading-notes-l1",
        slotId: "blog.header",
        cardinality: "singleton",
      };

      // Simulate parent window Salamanda Capability Broker
      Object.defineProperty(dom.window, "parent", {
        value: {
          postMessage: (msg: {
            channel: string;
            requestId: string;
            payload: { op: string; sql?: string; route?: string };
          }) => {
            if (msg.channel !== "salamanda.broker.v1") return;
            if (msg.payload.sql?.includes("TIMEOUT")) return;

            setTimeout(() => {
              if (msg.payload.op === "sidecar_query") {
                dom.window.dispatchEvent(
                  new dom.window.MessageEvent("message", {
                    data: {
                      channel: "salamanda.broker.v1.reply",
                      requestId: msg.requestId,
                      response: { ok: true, data: { rows: [{ note_md: "Oli otya" }] } },
                    },
                  })
                );
              } else if (msg.payload.op === "sidecar_execute") {
                dom.window.dispatchEvent(
                  new dom.window.MessageEvent("message", {
                    data: {
                      channel: "salamanda.broker.v1.reply",
                      requestId: msg.requestId,
                      response: { ok: true, data: { rowsAffected: 1 } },
                    },
                  })
                );
              } else if (msg.payload.op === "canonical_read") {
                dom.window.dispatchEvent(
                  new dom.window.MessageEvent("message", {
                    data: {
                      channel: "salamanda.broker.v1.reply",
                      requestId: msg.requestId,
                      response: { ok: false, error: "Denied sensitive collection" },
                    },
                  })
                );
              } else if (msg.payload.op === "limb_invoke") {
                dom.window.dispatchEvent(
                  new dom.window.MessageEvent("message", {
                    data: {
                      channel: "salamanda.broker.v1.reply",
                      requestId: msg.requestId,
                      response: {
                        ok: true,
                        data: { echoedRoute: msg.payload.route, audioUrl: "https://tts.example/1.mp3" },
                      },
                    },
                  })
                );
              }
            }, 5);
          },
        },
      });

      const [rows, execRes, fnRes] = await Promise.all([
        querySidecar<{ note_md: string }>("personal", "SELECT note_md FROM notes"),
        executeSidecar("personal", "INSERT INTO notes VALUES (?)", ["Hello"]),
        invokeLimbFunction<{ text: string }, { echoedRoute: string; audioUrl: string }>(
          "speak",
          { text: "Mwebale" }
        ),
      ]);

      expect(rows).toEqual([{ note_md: "Oli otya" }]);
      expect(execRes.rowsAffected).toBe(1);
      expect(fnRes.echoedRoute).toBe("/_limb/reading-notes-l1/speak");

      await expect(readCanonical("subscribers", "sub-1")).rejects.toThrow(
        "Denied sensitive collection"
      );

      await expect(
        querySidecar("personal", "SELECT TIMEOUT", [], 30)
      ).rejects.toThrow(/timed out/);
    } finally {
      globalThis.window = prevWindow;
      globalThis.document = prevDocument;
    }
  });
});
