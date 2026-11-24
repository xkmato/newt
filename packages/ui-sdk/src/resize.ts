import { getBootConfig } from "./broker.js";

export interface AutoResizeOptions {
  minHeight?: number;
  maxHeight?: number;
}

export function clampResizeHeight(
  rawHeight: number,
  minHeight = 0,
  maxHeight = 1200
): number {
  if (!Number.isFinite(rawHeight) || rawHeight < minHeight) return minHeight;
  if (rawHeight > maxHeight) return maxHeight;
  return Math.ceil(rawHeight);
}

/**
 * Observes the Limb root's intrinsic height and posts bounded `salamanda.resize.v1`
 * messages to `window.parent` so `<iframe sandbox="allow-scripts">` slots resize
 * cleanly with zero scrollbars and zero UI griefing (`maxHeight = 1200px` default).
 */
export function autoResizeFrame(options: AutoResizeOptions = {}): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return () => {};
  }

  const minHeight = options.minHeight ?? 0;
  const maxHeight = options.maxHeight ?? 1200;
  let lastReported = -1;

  const measureAndReport = () => {
    const target = document.getElementById("root") ?? document.body;
    if (!target) return;
    const raw = Math.max(
      target.scrollHeight || 0,
      target.getBoundingClientRect?.().height || 0
    );
    const clamped = clampResizeHeight(raw, minHeight, maxHeight);
    if (Math.abs(clamped - lastReported) < 1) return;
    lastReported = clamped;

    const boot = getBootConfig();
    window.parent?.postMessage(
      {
        channel: "salamanda.resize.v1",
        limbId: boot.limbId,
        slotId: boot.slotId,
        instanceKey: boot.instanceKey ?? "default",
        height: clamped,
      },
      "*"
    );
  };

  measureAndReport();

  if (typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver(() => measureAndReport());
    observer.observe(document.documentElement);
    if (document.body) observer.observe(document.body);
    return () => observer.disconnect();
  }

  window.addEventListener("resize", measureAndReport);
  return () => window.removeEventListener("resize", measureAndReport);
}
