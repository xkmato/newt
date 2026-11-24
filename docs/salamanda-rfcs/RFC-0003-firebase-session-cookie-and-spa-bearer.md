# RFC-0003: Dual-Issuer Firebase Session Cookie JWKS & Cookie-Less SPA Bearer Hydration

- **Status:** Ready for upstream review (`xkmato/salamanda` `v1.1.0`)
- **Target Crates:** `crates/salamanda-identity/src/lib.rs`, `crates/salamanda-proxy/src/lib.rs`
- **Reference Patch:** [`patches/rfc-0003-salamanda-identity-proxy.patch`](./patches/rfc-0003-salamanda-identity-proxy.patch)

## 1. Motivation

Supporting both SSR platforms (such as XKmato on Firebase Hosting + Next.js App Router) and cookie-less SPAs (Clerk, Supabase Auth, Auth0, Firebase client-only apps) requires two small additions:

1. **Firebase Dual-Issuer Verification:** Firebase Admin `createSessionCookie()` mints JWTs with issuer `https://session.firebase.google.com/<project-id>` signed by `identitytoolkit` public keys (`https://www.googleapis.com/identitytoolkit/v3/relyingparty/publicKeys`), whereas client-side `getIdToken()` Bearer JWTs have issuer `https://securetoken.google.com/<project-id>` signed by `securetoken` keys (`https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com`). `JwtJwksIdentityAdapter` `v1.0.0` currently validates only a single `issuer: String`, forcing operators to choose between SSR `__session` cookies OR client Bearer tokens instead of accepting both simultaneously.
2. **Client Bearer-Token Slot Hydration (`POST /_salamanda/slots-for-principal`):** On cookie-less SPAs, initial `GET /...` HTML navigations carry no `Authorization` header, so the Edge Proxy serves vanilla HTML on the fast path. Once the SPA authenticates in JS and obtains a Bearer JWT, it needs a single same-origin endpoint (`POST /_salamanda/slots-for-principal`) to retrieve the route-filtered `ResolvedSlotPayload[]` for the verified principal and mount them via `<amphibian-slot>` Shadow DOM.

## 2. Specification

### 2.1 Multi-Issuer `JwtJwksIdentityAdapter` & Firebase Preset (`salamanda-identity`)
- Extend `JwtJwksIdentityAdapter` with `pub additional_issuers: Vec<String>` (default empty).
- Pass all configured issuers (`&[&self.issuer, ...self.additional_issuers]`) to `jsonwebtoken::Validation::set_issuer(...)`.
- Provide convenience constructor and JWKS URL constants:
  ```rust
  pub const FIREBASE_ID_TOKEN_JWKS_URL: &str =
      "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
  pub const FIREBASE_SESSION_COOKIE_CERTS_URL: &str =
      "https://www.googleapis.com/identitytoolkit/v3/relyingparty/publicKeys";

  impl JwtJwksIdentityAdapter {
      pub fn firebase_dual_mode(project_id: impl AsRef<str>, cookie_name: impl Into<String>) -> Self {
          let pid = project_id.as_ref();
          Self::new(
              format!("https://session.firebase.google.com/{}", pid),
              pid,
              cookie_name,
          )
          .with_additional_issuer(format!("https://securetoken.google.com/{}", pid))
      }
  }
  ```

### 2.2 Client Slot Manifest Endpoint (`POST /_salamanda/slots-for-principal`)
- **Request:**
  - Header: `Authorization: Bearer <jwt>` (or `Cookie: __session=<jwt>`)
  - Body: `{ "route": "/blog/launching-amphibian" }`
- **Response (`200 OK`, `Cache-Control: private, no-store`, `Vary: Cookie, Authorization`):**
  ```json
  {
    "principal_uid": "uid:kenneth",
    "route": "/blog/launching-amphibian",
    "kill_switch": false,
    "slots": [
      {
        "limb_id": "blog-sidebar-margin-notes",
        "slot_id": "blog.sidebar",
        "cardinality": "singleton",
        "route_pattern": "/blog/*",
        "placement": "inside-end",
        "html_content": "<!DOCTYPE html>...",
        "isolation": "iframe",
        "allowed_sidecar_scope": "personal",
        "allowed_data_read": ["blogposts"]
      }
    ]
  }
  ```
- **Unauthenticated / Kill-Switch Behavior:**
  - Missing or invalid token -> `401 Unauthorized`.
  - Global kill-switch active -> `200 OK` with `"kill_switch": true, "slots": []` so clients cleanly unmount overlays without throwing errors.

## 3. Backward Compatibility

- Single-issuer `JwtJwksIdentityAdapter::new(issuer, audience, cookie_name)` keeps identical behavior when `additional_issuers` is empty.
- SSR HTML rewriting on cookie-authenticated routes continues working with zero changes.
