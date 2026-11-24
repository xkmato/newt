# Upstream Salamanda `v1.1` Contract RFCs

These three backward-compatible `v1.1` RFCs and reference patches target **[`xkmato/salamanda`](https://github.com/xkmato/salamanda)** so Limbs authored in Newt continue to run identically under Salamanda alone—even when Newt Studio and `@newt/bridge` are completely turned off.

| RFC | Target Crates | Capability | Backward Compatible (`v1.0.0`) | Patch |
| :--- | :--- | :--- | :--- | :--- |
| **[RFC-0001](./RFC-0001-shadow-dom-repeater-slots.md)** | `salamanda-overlay` | `<amphibian-slot>` Shadow-DOM mounting, `MutationObserver` repeater slots (`cardinality: "repeater"`), `salamanda.context.request.v1` / `reply.v1`, and bounded `salamanda.resize.v1` | Yes (defaults to `singleton`, light-DOM fallback for non-custom-element anchors) | [rfc-0001-salamanda-overlay.patch](./patches/rfc-0001-salamanda-overlay.patch) |
| **[RFC-0002](./RFC-0002-broker-limb-invoke.md)** | `salamanda-overlay`, `salamanda-proxy` | `BrokerRpcRequest::LimbInvoke` on `POST /_salamanda/broker` so opaque-origin `srcdoc` iframes invoke `/_limb/<id>/*` L2 functions with verified same-origin credentials | Yes (additive enum variant) | [rfc-0002-broker-limb-invoke.patch](./patches/rfc-0002-broker-limb-invoke.patch) |
| **[RFC-0003](./RFC-0003-firebase-session-cookie-and-spa-bearer.md)** | `salamanda-identity`, `salamanda-proxy` | Dual-issuer Firebase Session Cookie + ID Token JWKS verification and `POST /_salamanda/slots-for-principal` for cookie-less SPA Bearer hydration | Yes (existing single-issuer config & SSR HTML rewriting unchanged) | [rfc-0003-salamanda-identity-proxy.patch](./patches/rfc-0003-salamanda-identity-proxy.patch) |

## Verification

Consumer-driven contract tests covering all three RFC wire formats, security invariants, and backward-compatibility guarantees live in [`packages/contract/test/salamanda-v1_1-rfcs.test.ts`](../../packages/contract/test/salamanda-v1_1-rfcs.test.ts) and run as part of `pnpm test`.
