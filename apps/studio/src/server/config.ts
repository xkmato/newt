import os from "node:os";
import path from "node:path";

export type StudioFeatureFlag =
  | "l1"
  | "l2"
  | "l3"
  | "gallery"
  | "publish"
  | "monetization";

export interface StudioFeatureMap {
  l1: boolean;
  l2: boolean;
  l3: boolean;
  gallery: boolean;
  publish: boolean;
  monetization: boolean;
}

/**
 * Returns `true` ONLY when `NEWT_ENV === "local"`, or when running under Vitest
 * without `NEWT_ENV` explicitly configured. Default (production / unset) is secure (`false`).
 */
export function isLocalEnv(env: Record<string, string | undefined> = process.env): boolean {
  const raw = env.NEWT_ENV?.trim();
  if (raw) {
    return raw.toLowerCase() === "local";
  }
  return Boolean(env.VITEST);
}

/**
 * Parses `NEWT_FEATURES` (comma-separated, default `"l1,l2"`).
 * When running under Vitest without `NEWT_FEATURES` explicitly set, enables `gallery` and `publish`
 * so legacy gallery/publish tests continue passing; explicitly setting `NEWT_FEATURES` always overrides.
 */
export function getEnabledFeatures(
  env: Record<string, string | undefined> = process.env
): StudioFeatureMap {
  const explicit = env.NEWT_FEATURES?.trim();
  let tokens: Set<string>;
  if (explicit !== undefined && explicit !== "") {
    tokens = new Set(
      explicit
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean)
    );
  } else if (env.VITEST) {
    tokens = new Set(["l1", "l2", "gallery", "publish"]);
  } else {
    tokens = new Set(["l1", "l2"]);
  }

  const l3 = tokens.has("l3") || env.NEWT_ENABLE_L3_VARIANTS === "1";

  return {
    l1: tokens.has("l1"),
    l2: tokens.has("l2"),
    l3,
    gallery: tokens.has("gallery"),
    publish: tokens.has("publish"),
    monetization: tokens.has("monetization"),
  };
}

export function isFeatureEnabled(
  flag: StudioFeatureFlag,
  env: Record<string, string | undefined> = process.env
): boolean {
  return getEnabledFeatures(env)[flag];
}

/**
 * Resolves SQLite database path:
 * 1. explicit `dbPath` option
 * 2. `NEWT_DB_PATH`
 * 3. `NEWT_DATA_DIR/newt.db`
 * 4. `~/.newt/studio.sqlite`
 */
export function resolveStudioDbPath(
  explicitDbPath?: string,
  env: Record<string, string | undefined> = process.env
): string {
  if (explicitDbPath) return explicitDbPath;
  if (env.NEWT_DB_PATH?.trim()) return env.NEWT_DB_PATH.trim();
  if (env.NEWT_DATA_DIR?.trim()) return path.join(env.NEWT_DATA_DIR.trim(), "newt.db");
  return path.join(os.homedir(), ".newt", "studio.sqlite");
}

/**
 * Parses `NEWT_ALLOWED_FRAME_ANCESTORS` (space or comma separated origins).
 * Defaults to `["'none'"]` when unset so `/embed` is not frameable by untrusted origins.
 */
export function getAllowedFrameAncestors(
  env: Record<string, string | undefined> = process.env
): string[] {
  const raw = env.NEWT_ALLOWED_FRAME_ANCESTORS?.trim();
  if (!raw) {
    return ["'none'"];
  }
  const parsed = raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : ["'none'"];
}

export function buildEmbedCspHeader(
  env: Record<string, string | undefined> = process.env
): string {
  const ancestors = getAllowedFrameAncestors(env);
  return `frame-ancestors ${ancestors.join(" ")}`;
}

/**
 * Computes CORS headers for cross-origin bridge & embed API calls.
 */
export function buildCorsHeaders(
  originHeader?: string | null,
  env: Record<string, string | undefined> = process.env
): Record<string, string> {
  const allowed = new Set<string>([
    "http://localhost:8080",
    "http://127.0.0.1:8080",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3100",
    "http://127.0.0.1:3100",
  ]);
  for (const ancestor of getAllowedFrameAncestors(env)) {
    if (ancestor.startsWith("http://") || ancestor.startsWith("https://")) {
      allowed.add(ancestor.replace(/\/+$/, ""));
    }
  }
  const baseUrl = env.NEWT_BASE_URL?.trim();
  if (baseUrl) {
    try {
      allowed.add(new URL(baseUrl).origin);
    } catch {
      // ignore invalid URL
    }
  }

  const normalizedOrigin = originHeader?.trim().replace(/\/+$/, "");
  const allowOrigin =
    normalizedOrigin && allowed.has(normalizedOrigin)
      ? normalizedOrigin
      : isLocalEnv(env)
        ? "*"
        : "";

  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, Idempotency-Key, X-Dev-Uid, X-Newt-Uid",
    Vary: "Origin",
  };
  if (allowOrigin) {
    headers["Access-Control-Allow-Origin"] = allowOrigin;
  }
  return headers;
}
