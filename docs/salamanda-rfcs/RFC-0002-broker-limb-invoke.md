# RFC-0002: `LimbInvoke` Capability Broker RPC for Opaque-Origin `srcdoc` Iframes

- **Status:** Ready for upstream review (`xkmato/salamanda` `v1.1.0`)
- **Target Crates:** `crates/salamanda-overlay/src/lib.rs`, `crates/salamanda-proxy/src/lib.rs`
- **Reference Patch:** [`patches/rfc-0002-broker-limb-invoke.patch`](./patches/rfc-0002-broker-limb-invoke.patch)

## 1. Motivation

In Salamanda `v1.0.0`, sandboxed UI Limbs run inside `<iframe sandbox="allow-scripts" srcdoc="...">` with an opaque `"null"` origin. Because an opaque origin is cross-origin with the host platform, calling `fetch('/_limb/<id>/vote', { credentials: 'same-origin' })` directly from inside the iframe:
- Fails under the `srcdoc` strict CSP (`default-src 'none'`), and
- Cannot attach `HttpOnly; SameSite=Lax` session cookies (`__session`) or host Bearer tokens.

Meanwhile, the parent window's `/_salamanda/loader.js` already proxies `sidecar_query`, `sidecar_execute`, and `canonical_read` over `postMessage` (`salamanda.broker.v1`) to `POST /_salamanda/broker` with `credentials: 'same-origin'`. Adding `limb_invoke` to `BrokerRpcRequest` closes this gap cleanly without weakening iframe sandboxing.

## 2. Specification

### 2.1 Additive `BrokerRpcRequest::LimbInvoke` Variant (`salamanda-overlay`)
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum BrokerRpcRequest {
    SidecarQuery { /* unchanged */ },
    SidecarExecute { /* unchanged */ },
    CanonicalRead { /* unchanged */ },
    LimbInvoke {
        limb_id: String,
        route: String,
        #[serde(default = "default_invoke_method")]
        method: String,
        #[serde(default)]
        body: serde_json::Value,
    },
}
```

### 2.2 Capability & Route Prefix Validation (`validate_broker_rpc`)
Before dispatching `LimbInvoke`:
1. Confirm `limb_id` is actively bound in `active_mounts` for the verified principal.
2. Confirm `route` strictly starts with `format!("/_limb/{}/", limb_id)` and contains no `..` path traversal segments. Cross-limb invocation (Limb A attempting to call `/_limb/limb-b/...`) is rejected with `OverlayError::BrokerCapabilityDenied`.
3. Validate `method` is one of `GET | POST | PUT | PATCH | DELETE`.

### 2.3 Edge Proxy Dispatch (`salamanda-proxy::handle_broker_rpc`)
When `handle_broker_rpc` receives `BrokerRpcRequest::LimbInvoke`:
1. Look up `(method.to_ascii_uppercase(), route)` in the verified principal's `binding.functions`.
2. Execute `pool.execute_handler(&handler.ts_source, &handler.permissions, &FunctionInvocation { ... })` using the verified `principal` from `__session` or `Authorization: Bearer`.
3. Return `BrokerRpcResponse { ok: res.status < 400, data: Some(res.body), error: None }` so the iframe receives the typed JSON response via `salamanda.broker.v1.reply`.

## 3. Security Properties

- **Zero Credential Leakage:** `__session` cookies and Bearer JWTs remain strictly in the parent origin / Edge Proxy; the untrusted `srcdoc` iframe never reads them.
- **Cross-Limb Isolation:** Enforced at two layers: client-side `WeakMap` `event.source -> limbId` pinning (RFC-0001) and server-side `route.starts_with(&format!("/_limb/{}/", limb_id))` validation.
- **Kill-Switch & Quarantine:** Because `handle_broker_rpc` checks `state.is_kill_switch_active()` and `state.bindings.get(&principal.uid)`, killing or quarantining a Limb immediately cuts off broker-proxied invocations.
