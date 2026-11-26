import crypto from "node:crypto";

/**
 * Computes the deterministic 8-hex-character owner prefix for a principal UID:
 * `u-<8 hex of sha256(uid)>-`
 */
export function ownerLimbPrefix(ownerUid: string): string {
  const hash = crypto.createHash("sha256").update(ownerUid.trim()).digest("hex").slice(0, 8);
  return `u-${hash}-`;
}

/**
 * Produces an owner-namespaced, Salamanda-valid Limb ID (`u-<8hex>-<slug>`),
 * conforming to `^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$` (3..=64 chars).
 * Idempotent if `rawSlug` already carries the same owner prefix.
 */
export function namespaceLimbId(ownerUid: string, rawSlug: string): string {
  const prefix = ownerLimbPrefix(ownerUid);
  const stripped = rawSlug
    .trim()
    .toLowerCase()
    .replace(/^u-[0-9a-f]{8}-/, "");
  const cleanSlug = stripped
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  const maxSlugLen = 64 - prefix.length; // 53 chars
  let bounded = (cleanSlug || "limb").slice(0, maxSlugLen).replace(/-+$/g, "");
  if (!bounded) bounded = "limb";

  const candidate = `${prefix}${bounded}`;
  return candidate.replace(/-+$/g, "");
}

/**
 * Checks whether a limbId already carries the expected owner namespace prefix.
 */
export function isOwnerNamespacedLimbId(ownerUid: string, limbId: string): boolean {
  return limbId.startsWith(ownerLimbPrefix(ownerUid));
}
