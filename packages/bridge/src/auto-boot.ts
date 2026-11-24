import { initNewtBridge } from "./index.js";

if (typeof window !== "undefined" && typeof document !== "undefined") {
  const scriptEl =
    (document.currentScript as HTMLScriptElement | null) ??
    (document.getElementById("newt-bridge-script") as HTMLScriptElement | null);
  const newtOrigin =
    scriptEl?.dataset.newtOrigin ??
    (scriptEl?.src ? new URL(scriptEl.src, location.href).origin : location.origin);
  const baseId = scriptEl?.dataset.base ?? window.NewtHost?.baseId;
  const timeoutAttr = scriptEl?.dataset.timeoutMs;
  const timeoutMs = timeoutAttr ? Number(timeoutAttr) : undefined;

  void initNewtBridge({
    newtOrigin,
    baseId,
    timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : undefined,
  });
}
