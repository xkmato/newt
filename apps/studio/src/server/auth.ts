import crypto from "node:crypto";
import {
  type DelegationAuthContext,
  SalamandaControlPlaneClient,
  SalamandaHttpError,
} from "@newt/contract";
import type { ProjectRecord } from "@newt/db";
import { isLocalEnv } from "./config";

export class StudioAuthError extends Error {
  readonly status: number;

  constructor(message: string, status = 401) {
    super(message);
    this.name = "StudioAuthError";
    this.status = status;
  }
}

export interface AuthenticatedPrincipal {
  principalUid: string;
  auth: DelegationAuthContext;
  verified: boolean;
  /** True only in local mode when no identity header or token was provided at all */
  isLocalAnonymousFallback: boolean;
}

interface WhoamiCacheEntry {
  uid: string;
  issuer?: string;
  expiresAt: number;
}

const WHOAMI_CACHE_TTL_MS = 30_000;
const WHOAMI_CACHE_MAX_ENTRIES = 500;
const whoamiCache = new Map<string, WhoamiCacheEntry>();

export function clearWhoamiCache(): void {
  whoamiCache.clear();
}

function hashTokenKey(controlPlaneUrl: string, token: string): string {
  return crypto
    .createHash("sha256")
    .update(`${controlPlaneUrl}\0${token}`)
    .digest("hex");
}

function getCachedWhoami(key: string): WhoamiCacheEntry | null {
  const entry = whoamiCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    whoamiCache.delete(key);
    return null;
  }
  return entry;
}

function setCachedWhoami(key: string, entry: WhoamiCacheEntry): void {
  if (whoamiCache.size >= WHOAMI_CACHE_MAX_ENTRIES) {
    const oldestKey = whoamiCache.keys().next().value;
    if (oldestKey !== undefined) {
      whoamiCache.delete(oldestKey);
    }
  }
  whoamiCache.set(key, entry);
}

export function getSalamandaConfigFromEnv(
  env: Record<string, string | undefined> = process.env
): { controlPlaneUrl: string; clientId: string; clientKey: string } {
  return {
    controlPlaneUrl: env.SALAMANDA_CONTROL_PLANE_URL ?? "http://127.0.0.1:7474",
    clientId: env.SALAMANDA_CLIENT_ID ?? "amphibian-dev",
    clientKey: env.SALAMANDA_CLIENT_KEY ?? "dev-secret",
  };
}

async function verifyBearerViaSalamanda(
  bearerToken: string,
  options?: {
    client?: SalamandaControlPlaneClient;
    env?: Record<string, string | undefined>;
  }
): Promise<{ uid: string; issuer?: string }> {
  const env = options?.env ?? process.env;
  const cfg = getSalamandaConfigFromEnv(env);
  const cacheKey = hashTokenKey(cfg.controlPlaneUrl, bearerToken);
  const cached = getCachedWhoami(cacheKey);
  if (cached) {
    return { uid: cached.uid, issuer: cached.issuer };
  }

  const client = options?.client ?? new SalamandaControlPlaneClient(cfg);
  const verified = await client.whoami({ userBearerToken: bearerToken });
  setCachedWhoami(cacheKey, {
    uid: verified.uid,
    issuer: verified.issuer,
    expiresAt: Date.now() + WHOAMI_CACHE_TTL_MS,
  });
  return verified;
}

/**
 * Authenticates an inbound Newt Studio API request.
 *
 * Security model:
 * - When `NEWT_ENV !== "local"` (default secure):
 *   Requires `Authorization: Bearer <token>` and verifies it against Salamanda `GET /v1/whoami`
 *   (with a 30s SHA-256 keyed in-memory TTL cache, max 500 entries).
 *   `principalUid` is derived EXCLUSIVELY from the verified `/v1/whoami` response.
 *   Never trusts `x-dev-uid`, `x-newt-uid`, unverified JWT payloads, or `"uid:studio"`.
 *   Throws `StudioAuthError(401)` on missing or invalid token.
 * - When `NEWT_ENV === "local"` (or Vitest without explicit `NEWT_ENV`):
 *   If a Bearer token is provided, attempts verification via Salamanda `GET /v1/whoami`
 *   (returning 401 if Salamanda explicitly rejects it). Only if no Bearer token is provided
 *   (or Salamanda is unreachable in local dev), falls back to explicit `x-dev-uid` / `x-newt-uid`
 *   or `"uid:studio"`.
 */
export async function authenticateRequest(
  request: Request,
  options?: {
    client?: SalamandaControlPlaneClient;
    env?: Record<string, string | undefined>;
  }
): Promise<AuthenticatedPrincipal> {
  const env = options?.env ?? process.env;
  const local = isLocalEnv(env);

  const authHeader = request.headers.get("authorization")?.trim();
  const bearerToken =
    authHeader && authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : undefined;

  const idempotencyKey = request.headers.get("idempotency-key")?.trim() || undefined;

  const extraHeaders: Record<string, string> = {};
  const signedUid = request.headers.get("x-auth-uid")?.trim();
  const signedSig = request.headers.get("x-auth-sig")?.trim();
  if (signedUid && signedSig) {
    extraHeaders["x-auth-uid"] = signedUid;
    extraHeaders["x-auth-sig"] = signedSig;
  }

  // Non-local (production / default secure): strictly require & verify Bearer token via /v1/whoami
  if (!local) {
    if (!bearerToken) {
      throw new StudioAuthError("Authentication required: missing Authorization Bearer token", 401);
    }

    try {
      const whoami = await verifyBearerViaSalamanda(bearerToken, {
        client: options?.client,
        env,
      });
      return {
        principalUid: whoami.uid,
        auth: {
          userBearerToken: bearerToken,
          idempotencyKey,
          extraHeaders: Object.keys(extraHeaders).length > 0 ? extraHeaders : undefined,
        },
        verified: true,
        isLocalAnonymousFallback: false,
      };
    } catch (err) {
      if (err instanceof StudioAuthError) throw err;
      throw new StudioAuthError(
        `Authentication failed: unable to verify Bearer token via Salamanda (${err instanceof Error ? err.message : String(err)})`,
        401
      );
    }
  }

  // Local dev mode: prefer real /v1/whoami verification when Bearer token is present
  if (bearerToken) {
    try {
      const whoami = await verifyBearerViaSalamanda(bearerToken, {
        client: options?.client,
        env,
      });
      return {
        principalUid: whoami.uid,
        auth: {
          userBearerToken: bearerToken,
          idempotencyKey,
          extraHeaders: Object.keys(extraHeaders).length > 0 ? extraHeaders : undefined,
        },
        verified: true,
        isLocalAnonymousFallback: false,
      };
    } catch (err) {
      // If Salamanda explicitly rejected the token (401/403), fail closed even in local mode
      if (err instanceof SalamandaHttpError && (err.status === 401 || err.status === 403)) {
        throw new StudioAuthError("Authentication failed: Salamanda rejected Bearer token", 401);
      }
      // If Salamanda is unreachable in local offline mode, fall through only if explicit dev uid exists
      const fallbackDevUid =
        signedUid ||
        request.headers.get("x-dev-uid")?.trim() ||
        request.headers.get("x-newt-uid")?.trim();
      if (!fallbackDevUid) {
        throw new StudioAuthError(
          `Bearer token could not be verified (Salamanda unreachable in local mode): ${err instanceof Error ? err.message : String(err)}`,
          401
        );
      }
      return {
        principalUid: fallbackDevUid,
        auth: {
          userBearerToken: bearerToken,
          devUid: fallbackDevUid,
          idempotencyKey,
          extraHeaders: Object.keys(extraHeaders).length > 0 ? extraHeaders : undefined,
        },
        verified: false,
        isLocalAnonymousFallback: false,
      };
    }
  }

  // Local dev mode without Bearer token: allow explicit x-dev-uid / x-newt-uid or local fallback
  const devUidHeader =
    signedUid ||
    request.headers.get("x-dev-uid")?.trim() ||
    request.headers.get("x-newt-uid")?.trim() ||
    undefined;

  const principalUid = devUidHeader ?? "uid:studio";
  const isLocalAnonymousFallback = !devUidHeader;

  return {
    principalUid,
    auth: {
      devUid: signedUid ? undefined : principalUid,
      idempotencyKey,
      extraHeaders: Object.keys(extraHeaders).length > 0 ? extraHeaders : undefined,
    },
    verified: false,
    isLocalAnonymousFallback,
  };
}

/**
 * Enforces per-user project ownership.
 * - Always rejects cross-user access with HTTP 403.
 * - Only permits unauthenticated `"uid:studio"` fallback access in local mode when no explicit
 *   identity header or Bearer token was sent.
 */
export function assertProjectOwnership(
  project: ProjectRecord,
  principal: AuthenticatedPrincipal
): void {
  if (project.ownerUid === principal.principalUid) {
    return;
  }
  if (principal.isLocalAnonymousFallback) {
    return;
  }
  throw new StudioAuthError(
    `Forbidden: principal '${principal.principalUid}' does not own project '${project.id}'`,
    403
  );
}
