import crypto from "node:crypto";
import type { BaseSpec, Diagnostic, LimbManifest } from "@newt/contract";
import type { NewtVfs } from "./types.js";

const DEFAULT_HARD_DENY = [".env*", "firestore.rules", "firebase.json", "salamanda.toml"];

function matchesGlobPrefix(filePath: string, pattern: string): boolean {
  const prefix = pattern.replace(/\*+$/, "");
  return filePath === pattern || (prefix.length > 0 && filePath.startsWith(prefix));
}

export function computePatchSha256Digest(diffText: string): string {
  const hex = crypto.createHash("sha256").update(diffText, "utf8").digest("hex");
  return `sha256:${hex}`;
}

/**
 * Extracts all unique relative file paths modified by a unified git diff
 * (`--- a/<path>` and `+++ b/<path>`), mirroring `salamanda-variants::enforce_patch_edit_policy`.
 */
export function extractTouchedPathsFromUnifiedDiff(diffText: string): string[] {
  const touched: string[] = [];
  for (const line of diffText.split(/\r?\n/)) {
    let raw: string | null = null;
    if (line.startsWith("+++ b/")) raw = line.slice(6).trim();
    else if (line.startsWith("--- a/")) raw = line.slice(6).trim();
    else if (line.startsWith("+++ ") && !line.startsWith("+++ /dev/null")) {
      raw = line.slice(4).trim().replace(/^b\//, "");
    } else if (line.startsWith("--- ") && !line.startsWith("--- /dev/null")) {
      raw = line.slice(4).trim().replace(/^a\//, "");
    }

    if (!raw || raw === "/dev/null") continue;
    const normalized = raw.replace(/^\.?\//, "");
    if (!touched.includes(normalized)) {
      touched.push(normalized);
    }
  }
  return touched;
}

/**
 * Pre-flight `edit_allow` / `edit_deny` verification (`SAL-EDIT-001`) matching
 * `salamanda-variants` so forbidden edits (`.env*`, `firestore.rules`, `firebase.json`,
 * `salamanda.toml`, or paths outside `edit_allow`) are rejected deterministically.
 */
export function enforceVariantEditPolicy(
  touchedPaths: string[],
  baseSpec: BaseSpec
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const denyPatterns = Array.from(
    new Set([...DEFAULT_HARD_DENY, ...(baseSpec.variants?.edit_deny ?? [])])
  );
  const allowPatterns = baseSpec.variants?.edit_allow ?? [];

  for (const filePath of touchedPaths) {
    const normalized = filePath.replace(/^\.?\//, "");
    const hasTraversal = normalized.split("/").includes("..");
    const denied =
      hasTraversal || denyPatterns.some((pat) => matchesGlobPrefix(normalized, pat));

    if (denied) {
      diagnostics.push({
        code: "SAL-EDIT-001",
        severity: "error",
        path: "patches/variant.patch",
        message: `Patch modifies protected file '${filePath}' which violates base edit_deny policy.`,
        hint: "Level 3 variants cannot modify secrets, security rules, firebase.json, or salamanda.toml.",
        suggested_fix: `Remove edits to '${filePath}' from the unified diff.`,
      });
      continue;
    }

    if (allowPatterns.length > 0) {
      const allowed = allowPatterns.some((pat) => matchesGlobPrefix(normalized, pat));
      if (!allowed) {
        diagnostics.push({
          code: "SAL-EDIT-001",
          severity: "error",
          path: "patches/variant.patch",
          message: `Patch modifies '${filePath}' outside base edit_allow policy [${allowPatterns.join(", ")}].`,
          hint: "Only source paths listed in [variants].edit_allow may be patched.",
          suggested_fix: `Move changes under one of: ${allowPatterns.join(", ")}`,
        });
      }
    }
  }

  return diagnostics;
}

export interface VerifiedVariantPatch {
  diffFile: string;
  digest: string;
  touches: string[];
  diff: string;
}

/**
 * Verifies a Level 3 Limb's unified git diff (`patches/variant.patch`), its `sha256` digest,
 * its declared `[patch].touches` list, and pre-flight `SAL-EDIT-001` policy compliance.
 */
export function verifyLevel3VariantPatch(
  vfs: NewtVfs,
  manifest: LimbManifest,
  baseSpec: BaseSpec
): {
  patch?: VerifiedVariantPatch;
  diagnostics: Diagnostic[];
} {
  const diagnostics: Diagnostic[] = [];
  if (manifest.limb.level !== 3) {
    return { diagnostics };
  }

  const patchSpec = manifest.patch;
  if (!patchSpec) {
    diagnostics.push({
      code: "SAL-PATCH-001",
      severity: "error",
      path: "patch",
      message: "Level 3 limbs require a [patch] section with digest, diff_file, and touches.",
    });
    return { diagnostics };
  }

  const diffFile = patchSpec.diff_file ?? "patches/variant.patch";
  const diffText = vfs[diffFile];
  if (!diffText || !diffText.trim()) {
    diagnostics.push({
      code: "NEWT-PATCH-001",
      severity: "error",
      path: diffFile,
      message: `Level 3 unified diff file '${diffFile}' is missing or empty in project VFS.`,
      hint: "Generate a valid unified git diff with VariantPatchAgent.",
    });
    return { diagnostics };
  }

  if (!diffText.includes("@@") || !diffText.includes("+++ ")) {
    diagnostics.push({
      code: "NEWT-PATCH-001",
      severity: "error",
      path: diffFile,
      message: `File '${diffFile}' is not a valid unified git diff (missing '+++ ' or '@@' hunk headers).`,
    });
    return { diagnostics };
  }

  const actualTouches = extractTouchedPathsFromUnifiedDiff(diffText);
  if (actualTouches.length === 0) {
    diagnostics.push({
      code: "NEWT-PATCH-001",
      severity: "error",
      path: diffFile,
      message: `Unified diff '${diffFile}' does not touch any target files.`,
    });
    return { diagnostics };
  }

  // Enforce SAL-EDIT-001 on EVERY file actually touched by the diff
  diagnostics.push(...enforceVariantEditPolicy(actualTouches, baseSpec));

  // Verify [patch].touches matches actual diff paths (prevents hiding forbidden files)
  const declaredSet = new Set(patchSpec.touches.map((p) => p.replace(/^\.?\//, "")));
  for (const actual of actualTouches) {
    if (!declaredSet.has(actual)) {
      diagnostics.push({
        code: "NEWT-PATCH-002",
        severity: "error",
        path: "patch.touches",
        message: `Unified diff modifies '${actual}' which is not listed in [patch].touches.`,
        suggested_fix: `Add "${actual}" to [patch].touches in limb.toml.`,
      });
    }
  }

  const computedDigest = computePatchSha256Digest(diffText);
  if (patchSpec.digest !== computedDigest) {
    diagnostics.push({
      code: "NEWT-PATCH-003",
      severity: "error",
      path: "patch.digest",
      message: `Patch digest mismatch: manifest declares '${patchSpec.digest}', expected '${computedDigest}'.`,
      suggested_fix: `digest = "${computedDigest}"`,
    });
  }

  return {
    patch: {
      diffFile,
      digest: computedDigest,
      touches: actualTouches,
      diff: diffText,
    },
    diagnostics,
  };
}
