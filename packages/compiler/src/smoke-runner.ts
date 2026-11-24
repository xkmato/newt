import { JSDOM } from "jsdom";
import type { Diagnostic } from "@newt/contract";

/**
 * Stage 5: Mounts a compiled `srcdoc` HTML bundle inside a headless JSDOM sandbox,
 * simulates `salamanda.context.reply.v1` and `salamanda.broker.v1` replies, and
 * verifies that `#root` renders non-empty markup with zero uncaught exceptions.
 */
export async function runHeadlessUiSmokeCheck(params: {
  limbId: string;
  slotId: string;
  compiledHtml: string;
  sampleContextProps?: Record<string, string>;
}): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  const runtimeErrors: string[] = [];

  const dom = new JSDOM(params.compiledHtml, {
    url: "about:blank",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    beforeParse(win) {
      win.addEventListener("error", (ev) => {
        ev.preventDefault();
        runtimeErrors.push(ev.message || String(ev.error || "Unknown window error"));
      });
      win.addEventListener("unhandledrejection", (ev: PromiseRejectionEvent) => {
        runtimeErrors.push(String(ev.reason ?? "Unhandled promise rejection"));
      });

      Object.defineProperty(win, "parent", {
        value: {
          postMessage: (msg: {
            channel?: string;
            requestId?: string;
            payload?: { op?: string };
          }) => {
            if (!msg || typeof msg !== "object") return;
            if (msg.channel === "salamanda.context.request.v1") {
              setTimeout(() => {
                try {
                  win.dispatchEvent(
                    new win.MessageEvent("message", {
                      data: {
                        channel: "salamanda.context.reply.v1",
                        requestId: msg.requestId,
                        limbId: params.limbId,
                        slotId: params.slotId,
                        route: "/blog/launching-amphibian",
                        context: params.sampleContextProps ?? {
                          "post-id": "M9dqCTthbn1Re6senFms",
                          "post-slug": "launching-amphibian",
                        },
                        theme: "light",
                      },
                    })
                  );
                } catch {
                  // window already closed
                }
              }, 2);
            } else if (msg.channel === "salamanda.broker.v1" && msg.requestId) {
              setTimeout(() => {
                try {
                  win.dispatchEvent(
                    new win.MessageEvent("message", {
                      data: {
                        channel: "salamanda.broker.v1.reply",
                        requestId: msg.requestId,
                        response: {
                          ok: true,
                          data: { rows: [], rowsAffected: 0, document: null },
                        },
                      },
                    })
                  );
                } catch {
                  // window already closed
                }
              }, 2);
            }
          },
        },
      });
    },
  });

  try {
    await new Promise((resolve) => setTimeout(resolve, 40));

    for (const errText of runtimeErrors) {
      diagnostics.push({
        code: "NEWT-RUN-001",
        severity: "error",
        path: `ui:${params.slotId}`,
        message: `Uncaught runtime exception during slot mount: ${errText}`,
        hint: "Guard nullable DOM/data fields on initial render before sidecar data resolves.",
      });
    }

    const rootHtml = dom.window.document.getElementById("root")?.innerHTML.trim() ?? "";
    if (diagnostics.length === 0 && rootHtml.length === 0) {
      diagnostics.push({
        code: "NEWT-RUN-002",
        severity: "error",
        path: `ui:${params.slotId}`,
        message: `Slot '${params.slotId}' rendered empty #root markup.`,
        hint: "Export a default Preact component (export default function Widget() { ... }).",
      });
    }
  } finally {
    dom.window.close();
  }

  return diagnostics;
}
