# RFC-0001: Shadow-DOM Mounting, Repeater Slots, Context Handshake & Bounded Auto-Resize

- **Status:** Ready for upstream review (`xkmato/salamanda` `v1.1.0`)
- **Target Crate:** `crates/salamanda-overlay/src/lib.rs`
- **Reference Patch:** [`patches/rfc-0001-salamanda-overlay.patch`](./patches/rfc-0001-salamanda-overlay.patch)

## 1. Motivation

Auditing real Next.js 16 + React 19 (`reactCompiler: true`) host platforms (such as XKmato) revealed four runtime constraints in `salamanda-overlay` `v1.0.0`:

1. **React 19 App Router Hydration Safety:** App Router hydrates `<html>`/`<body>` directly without a `<div id="__next">` wrapper. Injecting light-DOM `<div>`/`<iframe>` nodes into React-managed elements risks hydration mismatch warnings or DOM reconciliation wipes. Mounting inside an open `ShadowRoot` on `<amphibian-slot data-salamanda-slot="...">` isolates Limb DOM completely from React/Vue/Svelte reconcilers and prevents host Tailwind v4 CSS resets from bleeding in.
2. **Client-Fetched & Infinite-Scroll Repeater Lists:** Feeds such as `/feed` render `MicropostCard` elements client-side and append more via `IntersectionObserver`. `v1.0.0`'s `CLIENT_LOADER_JS` calls `document.querySelector(...)` once per slot and keys containers by `salamanda-mount-<limb>-<slot>`, which mounts only the first card and misses dynamically appended items.
3. **Interactive Context, Theme & Form Support:** `srcdoc` iframes using `@newt/ui-sdk` request runtime props (`data-post-id`, `data-post-slug`, `route`, `theme`, host `--newt-*` CSS variables) over `salamanda.context.request.v1` and submit semantic HTML `<form>` elements requiring `sandbox="allow-scripts allow-forms"`.
4. **Zero-Scrollbar Auto-Resize:** Sandboxed iframes report intrinsic height via `salamanda.resize.v1`, which must be clamped (`0..1200px`) to prevent UI griefing.

## 2. Specification

### 2.1 Additive `ResolvedSlotPayload.cardinality`
```rust
#[serde(default = "default_cardinality")]
pub cardinality: String, // "singleton" (default) | "repeater"
```

### 2.2 `CLIENT_LOADER_JS` Protocol Extensions (`/_salamanda/loader.js`)
- **Shadow-DOM Anchor Mounting:** If `anchor.tagName === 'AMPHIBIAN-SLOT'` and `anchor.attachShadow` exists, mount into `anchor.shadowRoot || anchor.attachShadow({ mode: 'open' })` and set `anchor.setAttribute('data-salamanda-mounted', 'true')` (enabling pure CSS `:has(amphibian-slot[data-salamanda-mounted="true"])` progressive sidebars). For legacy `<div data-salamanda-slot="...">` anchors, fall back to appending directly into `anchor`.
- **Repeater Cardinality & `MutationObserver`:** Query all matching anchors with `document.querySelectorAll('[data-salamanda-slot="' + m.slot_id + '"]')`. For `"singleton"` slots, mount only on the first anchor; for `"repeater"` slots, derive `instanceKey = ctxProps['post-id'] || ctxProps['item-id'] || String(idx)` and key containers by `salamanda-mount-${m.limb_id}-${m.slot_id}-${instanceKey}`. Observe `document.body` with a `requestAnimationFrame`-coalesced `MutationObserver` to hydrate dynamically appended cards.
- **Iframe Sandbox:** Use `sandbox="allow-scripts allow-forms"` and `referrerpolicy="no-referrer"` (keeping opaque `"null"` origin isolation with no `allow-same-origin`).
- **Context & Theme Handshake:** Maintain a `WeakMap<Window, FrameMeta>` mapping each mounted iframe's `contentWindow` to `{ limbId, slotId, instanceKey, context, iframe }`. On `salamanda.context.request.v1`, verify `event.source` is registered (and pin `Origin.from(event)` when supported) and reply with:
  ```json
  {
    "channel": "salamanda.context.reply.v1",
    "requestId": "...",
    "limbId": "...",
    "slotId": "...",
    "instanceKey": "...",
    "route": "/blog/launching-amphibian",
    "context": { "post-id": "M9dqCTthbn1Re6senFms" },
    "theme": "dark"
  }
  ```
  Observe `document.documentElement` (`class` attribute) to push updated `theme` replies whenever the host switches `.dark` mode.
- **Bounded Auto-Resize:** On `salamanda.resize.v1` from a registered `event.source`, clamp `height` to `[0, 1200]` px and update `iframe.style.height`.
- **Broker Source Pinning:** On `salamanda.broker.v1`, reject requests where `msg.payload.limb_id !== meta.limbId` before forwarding to `POST /_salamanda/broker`.

## 3. Backward Compatibility

- Existing `v1.0.0` manifests omit `cardinality`, which defaults to `"singleton"`.
- Existing `<div data-salamanda-slot="...">` templates continue working unchanged via the light-DOM fallback.
- Raw HTML Limbs that do not emit `salamanda.context.request.v1` or `salamanda.resize.v1` render identically.
