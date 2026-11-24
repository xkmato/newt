export interface NewtHostAdapter {
  baseId?: string;
  manifestUrl?: string;
  salamandaOrigin?: string;
  getAuthToken?: () => Promise<string | null>;
  openDrawer?: (options?: { slotId?: string }) => void;
  closeDrawer?: () => void;
  previewInline?: (payload: InlinePreviewPayload) => void;
}

export interface InlinePreviewPayload {
  slotId: string;
  limbId: string;
  compiledHtml: string;
  cardinality?: "singleton" | "repeater";
}

export interface BridgeBootOptions {
  newtOrigin: string;
  baseId?: string;
  manifestUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface BridgeHandle {
  readonly ready: boolean;
  openDrawer: (options?: { slotId?: string }) => void;
  closeDrawer: () => void;
  previewInline: (payload: InlinePreviewPayload) => void;
  enterSlotPicker: () => void;
  exitSlotPicker: () => void;
  destroy: () => void;
}

declare global {
  interface Window {
    NewtHost?: NewtHostAdapter;
  }
}

interface MountedFrameMeta {
  limbId: string;
  slotId: string;
  instanceKey: string;
  context: Record<string, string>;
  iframe: HTMLIFrameElement;
}

const DEFAULT_TIMEOUT_MS = 2500;
const MAX_RESIZE_PX = 1200;

let sharedSlotSheet: CSSStyleSheet | null = null;

function getSharedSlotSheet(): CSSStyleSheet | null {
  if (typeof CSSStyleSheet === "undefined") return null;
  if (!sharedSlotSheet) {
    try {
      const s = new CSSStyleSheet();
      s.replaceSync(
        ":host{display:block;width:100%}.nb-wrap{width:100%}iframe{width:100%;border:0;display:block;background:transparent}"
      );
      sharedSlotSheet = s;
    } catch {
      return null;
    }
  }
  return sharedSlotSheet;
}

export function clampHeight(raw: number): number {
  if (!Number.isFinite(raw) || raw < 0) return 0;
  return Math.min(MAX_RESIZE_PX, Math.ceil(raw));
}

export function extractAnchorContext(el: Element): Record<string, string> {
  const ctx: Record<string, string> = {};
  for (let i = 0; i < el.attributes.length; i++) {
    const a = el.attributes[i];
    if (
      a &&
      a.name.startsWith("data-") &&
      a.name !== "data-salamanda-slot" &&
      a.name !== "data-salamanda-mounted"
    ) {
      ctx[a.name.slice(5)] = a.value;
    }
  }
  return ctx;
}

export function computeSlotInstanceKey(
  ctx: Record<string, string>,
  cardinality: "singleton" | "repeater",
  index: number
): string {
  if (cardinality !== "repeater") return "default";
  return ctx["post-id"] || ctx["item-id"] || String(index);
}

function currentTheme(): "light" | "dark" {
  const root = document.documentElement;
  if (root.classList.contains("dark")) return "dark";
  if (root.getAttribute("data-theme") === "dark") return "dark";
  try {
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

function sampleHostCssVars(): Record<string, string> {
  const vars: Record<string, string> = {};
  try {
    const cs = getComputedStyle(document.documentElement);
    const map: Array<[string, string[]]> = [
      ["--newt-bg", ["--background", "--bg", "--blog-bg"]],
      ["--newt-card", ["--card", "--blog-card", "--surface"]],
      ["--newt-fg", ["--foreground", "--fg", "--blog-fg"]],
      ["--newt-muted", ["--muted-foreground", "--muted"]],
      ["--newt-primary", ["--primary", "--blog-accent", "--accent"]],
      ["--newt-border", ["--border", "--blog-border"]],
      ["--newt-radius", ["--radius"]],
    ];
    for (const [newtKey, candidates] of map) {
      for (const c of candidates) {
        const v = cs.getPropertyValue(c).trim();
        if (v) {
          vars[newtKey] = v;
          break;
        }
      }
    }
  } catch {
    // ignore computed style errors
  }
  return vars;
}

function collectAvailableSlots(): string[] {
  const ids = new Set<string>();
  document.querySelectorAll("[data-salamanda-slot]").forEach((el) => {
    const id = el.getAttribute("data-salamanda-slot");
    if (id) ids.add(id);
  });
  return Array.from(ids);
}

function mountIntoShadowAnchor(
  anchor: Element,
  payload: InlinePreviewPayload,
  instanceKey: string,
  ctx: Record<string, string>,
  frameRegistry: WeakMap<Window, MountedFrameMeta>,
  mountedList: MountedFrameMeta[]
): void {
  const containerKey = `${payload.limbId}:${payload.slotId}:${instanceKey}`;
  const isCustom = anchor.tagName === "AMPHIBIAN-SLOT" && typeof anchor.attachShadow === "function";
  const root: ParentNode = isCustom
    ? anchor.shadowRoot ?? anchor.attachShadow({ mode: "open", delegatesFocus: true })
    : anchor;

  if (isCustom && root instanceof ShadowRoot) {
    const sheet = getSharedSlotSheet();
    if (sheet && "adoptedStyleSheets" in root && root.adoptedStyleSheets.length === 0) {
      try {
        root.adoptedStyleSheets = [sheet];
      } catch {
        // ignore in JSDOM
      }
    }
  }

  const existing = root.querySelector(`[data-newt-mount="${containerKey}"]`) as HTMLElement | null;
  if (existing && existing.getAttribute("data-newt-hash") === String(payload.compiledHtml.length)) {
    return;
  }
  if (existing) existing.remove();

  const wrap = document.createElement("div");
  wrap.className = "nb-wrap";
  wrap.setAttribute("data-newt-mount", containerKey);
  wrap.setAttribute("data-newt-hash", String(payload.compiledHtml.length));
  wrap.setAttribute("data-salamanda-limb", payload.limbId);

  const iframe = document.createElement("iframe");
  iframe.title = `${payload.limbId} (${payload.slotId})`;
  iframe.setAttribute("sandbox", "allow-scripts allow-forms");
  iframe.setAttribute("referrerpolicy", "no-referrer");
  iframe.style.width = "100%";
  iframe.style.border = "0";
  iframe.style.display = "block";
  iframe.style.minHeight = "64px";
  iframe.setAttribute("srcdoc", payload.compiledHtml);

  wrap.appendChild(iframe);
  root.appendChild(wrap);
  anchor.setAttribute("data-salamanda-mounted", "true");

  if (iframe.contentWindow) {
    const meta: MountedFrameMeta = {
      limbId: payload.limbId,
      slotId: payload.slotId,
      instanceKey,
      context: ctx,
      iframe,
    };
    frameRegistry.set(iframe.contentWindow, meta);
    mountedList.push(meta);
  }
}

async function probeHealthFailOpen(
  newtOrigin: string,
  timeoutMs: number,
  fetchImpl: typeof fetch
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${newtOrigin}/api/v1/health`, {
      method: "GET",
      mode: "cors",
      credentials: "omit",
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Initializes the fail-open, auth-vendor-agnostic `@newt/bridge` on any web host.
 * If Newt does not respond `200 OK` within `timeoutMs` (default `2500ms`), returns
 * a silent no-op handle with zero DOM mutations, zero console errors, and zero CLS.
 */
export async function initNewtBridge(options: BridgeBootOptions): Promise<BridgeHandle> {
  const noop: BridgeHandle = {
    ready: false,
    openDrawer: () => {},
    closeDrawer: () => {},
    previewInline: () => {},
    enterSlotPicker: () => {},
    exitSlotPicker: () => {},
    destroy: () => {},
  };

  if (typeof window === "undefined" || typeof document === "undefined") {
    return noop;
  }

  const newtOrigin = options.newtOrigin.replace(/\/+$/, "");
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? window.fetch.bind(window);

  const healthy = await probeHealthFailOpen(newtOrigin, timeoutMs, fetchImpl);
  if (!healthy) {
    return noop;
  }

  const hostAdapter: NewtHostAdapter = window.NewtHost ?? {};
  const baseId = options.baseId ?? hostAdapter.baseId ?? "custom";
  const manifestUrl = options.manifestUrl ?? hostAdapter.manifestUrl ?? "/.well-known/amphibian.json";

  const activePreviews = new Map<string, InlinePreviewPayload>();
  const frameRegistry = new WeakMap<Window, MountedFrameMeta>();
  const mountedList: MountedFrameMeta[] = [];

  let drawerDialog: HTMLDialogElement | null = null;
  let drawerIframe: HTMLIFrameElement | null = null;
  let drawerPort: MessagePort | null = null;
  let pendingSelectedSlot: string | undefined;
  let pickerOverlay: HTMLElement | null = null;
  let pickerActive = false;
  let rafScheduled = false;

  const hydrateActivePreviews = () => {
    for (const preview of activePreviews.values()) {
      const anchors = document.querySelectorAll(`[data-salamanda-slot="${preview.slotId}"]`);
      const cardinality = preview.cardinality ?? "singleton";
      anchors.forEach((anchor, idx) => {
        if (cardinality !== "repeater" && idx > 0) return;
        const ctx = extractAnchorContext(anchor);
        const key = computeSlotInstanceKey(ctx, cardinality, idx);
        mountIntoShadowAnchor(anchor, preview, key, ctx, frameRegistry, mountedList);
      });
    }
  };

  const previewInline = (payload: InlinePreviewPayload) => {
    activePreviews.set(`${payload.limbId}:${payload.slotId}`, payload);
    hydrateActivePreviews();
  };

  const exitSlotPicker = () => {
    pickerActive = false;
    pickerOverlay?.remove();
    pickerOverlay = null;
  };

  const enterSlotPicker = () => {
    exitSlotPicker();
    pickerActive = true;
    const overlay = document.createElement("div");
    overlay.id = "newt-slot-picker-overlay";
    overlay.setAttribute("role", "region");
    overlay.setAttribute("aria-label", "Select a slot on the page");
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:2147483645;pointer-events:none;";

    const anchors = document.querySelectorAll("[data-salamanda-slot]");
    anchors.forEach((anchor) => {
      const slotId = anchor.getAttribute("data-salamanda-slot");
      if (!slotId) return;
      const rect = anchor.getBoundingClientRect();
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = `+ ${slotId}`;
      btn.setAttribute("data-newt-pick-slot", slotId);
      btn.style.cssText =
        `position:fixed;left:${Math.max(4, rect.left)}px;top:${Math.max(4, rect.top)}px;` +
        `min-width:${Math.max(120, rect.width)}px;min-height:${Math.max(30, rect.height)}px;` +
        "pointer-events:auto;border:2px dashed #10b981;background:rgba(16,185,129,0.14);" +
        "color:#065f46;font:600 12px system-ui,sans-serif;border-radius:8px;cursor:pointer;";
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const contextProps = extractAnchorContext(anchor);
        exitSlotPicker();
        drawerPort?.postMessage({
          protocol: "newt.host.v1",
          type: "newt.host.slot_picked",
          slotId,
          contextProps,
        });
      });
      overlay.appendChild(btn);
    });

    document.body.appendChild(overlay);
    pickerOverlay = overlay;
  };

  const sendInitOverPort = async () => {
    if (!drawerPort) return;
    let userToken: string | null = null;
    try {
      userToken = (await window.NewtHost?.getAuthToken?.()) ?? null;
    } catch {
      userToken = null;
    }
    drawerPort.postMessage({
      protocol: "newt.host.v1",
      type: "newt.host.init",
      baseId,
      manifestUrl,
      hostOrigin: location.origin,
      route: location.pathname,
      availableSlots: collectAvailableSlots(),
      selectedSlot: pendingSelectedSlot,
      theme: currentTheme(),
      cssVars: sampleHostCssVars(),
      userToken,
    });
  };

  const connectDrawerChannel = () => {
    if (!drawerIframe?.contentWindow) return;
    drawerPort?.close();
    const channel = new MessageChannel();
    drawerPort = channel.port1;
    drawerPort.onmessage = (ev: MessageEvent) => {
      const msg = ev.data as Record<string, unknown> | undefined;
      if (!msg || msg.protocol !== "newt.host.v1") return;
      if (msg.type === "newt.embed.enter_slot_picker") {
        enterSlotPicker();
      } else if (msg.type === "newt.embed.exit_slot_picker") {
        exitSlotPicker();
      } else if (msg.type === "newt.embed.preview_inline") {
        previewInline({
          slotId: String(msg.slotId ?? ""),
          limbId: String(msg.limbId ?? ""),
          compiledHtml: String(msg.compiledHtml ?? ""),
          cardinality: msg.cardinality === "repeater" ? "repeater" : "singleton",
        });
      } else if (msg.type === "newt.embed.binding_updated") {
        window.dispatchEvent(
          new CustomEvent("newt:bindings-updated", { detail: { limbIds: msg.limbIds ?? [] } })
        );
      } else if (msg.type === "newt.embed.close_drawer") {
        closeDrawer();
      }
    };
    drawerPort.start();
    drawerIframe.contentWindow.postMessage(
      { protocol: "newt.host.v1", type: "newt.host.connect" },
      newtOrigin,
      [channel.port2]
    );
    void sendInitOverPort();
  };

  const ensureDrawer = () => {
    if (drawerDialog) return;
    const dialog = document.createElement("dialog");
    dialog.id = "newt-embed-drawer";
    dialog.setAttribute("aria-label", "Newt Limb Builder");
    const supportsPopover = Object.hasOwn(HTMLElement.prototype, "popover");
    if (supportsPopover) {
      dialog.setAttribute("popover", "manual");
    }
    dialog.style.cssText =
      "position:fixed;inset:0 0 0 auto;margin:0;width:min(440px,100vw);height:100vh;max-height:100vh;" +
      "padding:0;border:0;border-left:1px solid rgba(128,128,128,0.25);background:transparent;z-index:2147483646;";

    const iframe = document.createElement("iframe");
    iframe.title = "Newt Embedded Builder";
    iframe.src = `${newtOrigin}/embed?base=${encodeURIComponent(baseId)}`;
    iframe.style.cssText = "width:100%;height:100%;border:0;display:block;";
    iframe.addEventListener("load", connectDrawerChannel);

    dialog.appendChild(iframe);
    document.body.appendChild(dialog);
    drawerDialog = dialog;
    drawerIframe = iframe;
  };

  const openDrawer = (opts?: { slotId?: string }) => {
    pendingSelectedSlot = opts?.slotId;
    ensureDrawer();
    if (!drawerDialog) return;
    if (typeof drawerDialog.showPopover === "function" && drawerDialog.hasAttribute("popover")) {
      try {
        drawerDialog.showPopover();
      } catch {
        // already open
      }
    } else if (!drawerDialog.open) {
      drawerDialog.show();
    }
    if (drawerPort) {
      void sendInitOverPort();
    }
  };

  const closeDrawer = () => {
    exitSlotPicker();
    if (!drawerDialog) return;
    if (typeof drawerDialog.hidePopover === "function" && drawerDialog.hasAttribute("popover")) {
      try {
        drawerDialog.hidePopover();
      } catch {
        // already closed
      }
    } else if (drawerDialog.open) {
      drawerDialog.close();
    }
  };

  // Frame message listener for mounted ephemeral previews (`context.request.v1` + `resize.v1`)
  // and the `/embed` iframe ready handshake (`newt.embed.ready`)
  const onWindowMessage = (event: MessageEvent) => {
    if (!event.source || typeof event.data !== "object" || event.data === null) return;
    const raw = event.data as {
      protocol?: string;
      type?: string;
      channel?: string;
      requestId?: string;
      height?: number;
    };

    if (
      drawerIframe?.contentWindow &&
      event.source === drawerIframe.contentWindow &&
      raw.protocol === "newt.host.v1" &&
      raw.type === "newt.embed.ready"
    ) {
      connectDrawerChannel();
      return;
    }

    const meta = frameRegistry.get(event.source as Window);
    if (!meta) return;
    const msg = raw;

    if (msg.channel === "salamanda.context.request.v1") {
      (event.source as Window).postMessage(
        {
          channel: "salamanda.context.reply.v1",
          requestId: msg.requestId,
          limbId: meta.limbId,
          slotId: meta.slotId,
          instanceKey: meta.instanceKey,
          route: location.pathname,
          context: meta.context,
          theme: currentTheme(),
          cssVars: sampleHostCssVars(),
        },
        "*"
      );
      return;
    }

    if (msg.channel === "salamanda.resize.v1" && typeof msg.height === "number") {
      meta.iframe.style.height = `${clampHeight(msg.height)}px`;
    }
  };

  const onRouteChange = () => {
    hydrateActivePreviews();
    drawerPort?.postMessage({
      protocol: "newt.host.v1",
      type: "newt.host.route_changed",
      route: location.pathname,
      availableSlots: collectAvailableSlots(),
    });
  };

  window.addEventListener("message", onWindowMessage);
  window.addEventListener("newt:route-change", onRouteChange);
  window.addEventListener("popstate", onRouteChange);

  const domObserver = new MutationObserver(() => {
    if (rafScheduled) return;
    rafScheduled = true;
    const flush = () => {
      rafScheduled = false;
      hydrateActivePreviews();
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(flush);
    else setTimeout(flush, 16);
  });
  if (document.body) {
    domObserver.observe(document.body, { childList: true, subtree: true });
  }

  const themeObserver = new MutationObserver(() => {
    const theme = currentTheme();
    const cssVars = sampleHostCssVars();
    for (const meta of mountedList) {
      try {
        meta.iframe.contentWindow?.postMessage(
          {
            channel: "salamanda.context.reply.v1",
            limbId: meta.limbId,
            slotId: meta.slotId,
            instanceKey: meta.instanceKey,
            route: location.pathname,
            context: meta.context,
            theme,
            cssVars,
          },
          "*"
        );
      } catch {
        // iframe detached
      }
    }
  });
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "data-theme"],
  });

  // Expose host API and fire `newt:ready` ONLY after fail-open health probe succeeded
  window.NewtHost = {
    ...hostAdapter,
    baseId,
    manifestUrl,
    openDrawer,
    closeDrawer,
    previewInline,
  };
  window.dispatchEvent(new CustomEvent("newt:ready", { detail: { baseId, newtOrigin } }));

  return {
    ready: true,
    openDrawer,
    closeDrawer,
    previewInline,
    enterSlotPicker,
    exitSlotPicker,
    destroy: () => {
      exitSlotPicker();
      closeDrawer();
      domObserver.disconnect();
      themeObserver.disconnect();
      window.removeEventListener("message", onWindowMessage);
      window.removeEventListener("newt:route-change", onRouteChange);
      window.removeEventListener("popstate", onRouteChange);
      drawerPort?.close();
      drawerDialog?.remove();
    },
  };
}
