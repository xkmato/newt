# Running Newt Studio Locally with `blog` & Salamanda

This guide documents how to run **Newt Studio** (`apps/studio`, port `3100`) as the Amphibian authoring studio for the **`blog`** base (`apps/web`, port `3000`) fronted by the **Salamanda** daemon (edge proxy `:8080`, control plane `:7474`).

## Port Map

| Service | Port | Notes |
| :--- | :--- | :--- |
| Salamanda Edge Proxy | `8080` | Browser entry point; proxies `blog` on `:3000` |
| Salamanda Control Plane | `7474` | Loopback only; Newt calls `/v1/whoami`, `/v1/limbs`, `/v1/principals/*/bindings`, `/v1/principals/*/preview` |
| `blog` Next.js App | `3000` | Serves `/.well-known/amphibian.json` and `/api/health` |
| **Newt Studio** | `3100` | Serves `/bridge.js`, `/embed` drawer, Studio UI, and `/api/v1/*` |

## Environment Variables

| Variable | Default | Description |
| :--- | :--- | :--- |
| `NEWT_ENV` | *(unset -> secure production)* | Set to `local` for local dev fallbacks. When unset or any non-`local` value, every `/api/v1/*` route (except `/api/v1/health` and `/api/v1/bases`) strictly requires `Authorization: Bearer <token>` verified via Salamanda `GET /v1/whoami`. |
| `NEWT_DATA_DIR` | `~/.newt/` | Directory where `newt.db` (SQLite WAL) is stored (e.g. `../amphibian/.data/newt`). `NEWT_DB_PATH` overrides if set. |
| `NEWT_BASE_URL` | *(unset)* | Origin serving `/.well-known/amphibian.json` (local: `http://127.0.0.1:3000`). Studio dynamically fetches, validates, and registers the `blog` base (retrying lazily on `GET /api/v1/bases` or project creation if `blog` wasn't ready at boot, falling back gracefully to the built-in `blog` manifest offline). |
| `NEWT_FEATURES` | `l1,l2` | Comma-separated feature flags. Opt-in flags: `gallery`, `publish`, `monetization`, `l3`. Disabled features are hidden in UI and return HTTP `404` on API routes. |
| `NEWT_ALLOWED_FRAME_ANCESTORS` | `'none'` | Space- or comma-separated list of origins permitted to frame `/embed` via `Content-Security-Policy: frame-ancestors ...` (local: `http://localhost:8080 http://127.0.0.1:8080 http://localhost:3000`). |
| `SALAMANDA_CONTROL_PLANE_URL` | `http://127.0.0.1:7474` | Loopback URL for Salamanda's Control Plane. |
| `SALAMANDA_CLIENT_ID` | `amphibian-dev` | Server-held ClientDelegationAuth client ID (local orchestrator default: `amphibian-local`). Never exposed to the browser. |
| `SALAMANDA_CLIENT_KEY` | `dev-secret` | Server-held ClientDelegationAuth client key. Never exposed to the browser. |
| `GEMINI_API_KEY` | *(unset)* | Google Gemini API key for live agent synthesis (`gemini-2.5-flash`). |
| `NEWT_STUDIO_DEMO_PROVIDER` | *(unset)* | Set to `1` to force the deterministic offline synthesizer (used for offline dev & CI tests). |
| `PORT` | `3100` | Port used by `pnpm --filter @newt/studio dev` and `start`. |

## Quickstart

```bash
# 1. Build workspace packages (including @newt/bridge dist/bridge.js)
pnpm build

# 2. Start Newt Studio wired to local blog + Salamanda
NEWT_ENV=local \
NEWT_DATA_DIR=/Users/kenneth/Code/amphibian/.data/newt \
NEWT_BASE_URL=http://127.0.0.1:3000 \
NEWT_FEATURES=l1,l2 \
NEWT_ALLOWED_FRAME_ANCESTORS="http://localhost:8080 http://127.0.0.1:8080 http://localhost:3000" \
SALAMANDA_CONTROL_PLANE_URL=http://127.0.0.1:7474 \
SALAMANDA_CLIENT_ID=amphibian-local \
SALAMANDA_CLIENT_KEY="<key-from-orchestrator>" \
GEMINI_API_KEY="<your-key>" \
pnpm --filter @newt/studio dev
```

## Authentication & Project Ownership

1. In the host `blog` app, `window.NewtHost` exposes `{ baseId: "blog", getAuthToken: () => Promise<string | null> }` returning the signed-in user's Firebase ID token.
2. When `@newt/bridge` (`/bridge.js`) boots, it probes `GET http://localhost:3100/api/v1/health` (fail-open within 2.5s), attaches `openDrawer` / `closeDrawer` / `previewInline` to `window.NewtHost`, and dispatches `newt:ready`.
3. Opening the drawer iframes `http://localhost:3100/embed?base=blog`, establishes a `MessageChannel` (`newt.host.v1`), and passes the user's token in `newt.host.init` (with on-demand refresh via `newt.embed.request_token` -> `newt.host.token`).
4. `EmbedDrawer` attaches `Authorization: Bearer <token>` on every `/api/v1/*` request.
5. Studio verifies the token via Salamanda `GET /v1/whoami` (cached in memory for 30s, keyed by SHA-256 of the token, max 500 entries), derives `principalUid` exclusively from the verified response, namespaces generated Limb IDs as `u-<8hex>-<slug>`, sets `limb.author = principalUid`, and enforces per-user ownership on all project endpoints (`403` on cross-user access).

## Preview & Retry-Safe Deploy Flow

- **Preview Inline**: mounts unsaved compiled HTML into `<amphibian-slot>` Shadow DOM via `@newt/bridge` (ephemeral authoring preview only; `@newt/bridge` never mounts saved Salamanda Limbs).
- **Preview Live on Page**: `POST /api/v1/projects/:id/preview` uploads the compiled Limb and calls Salamanda `POST /v1/principals/{uid}/preview` for the signed-in user's session only.
- **Activate on Salamanda**: `POST /api/v1/projects/:id/deploy` sends a deterministic `Idempotency-Key` per `(projectId, snapshotId, principalUid)`, upserts the Limb, binds it for the user, and records the deployment (`active` or `failed` on partial failure so retries are safe).
- **Status Polling**: `GET /api/v1/projects/:id/deployment` reports the latest deployment status and live Salamanda bindings for the drawer.
