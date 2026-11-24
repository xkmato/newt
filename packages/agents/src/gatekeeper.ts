import type { AmphibianPlatformManifest } from "@newt/base-sdk";
import type { LimbBlueprint } from "./types.js";

export interface GatekeeperResult {
  allowed: boolean;
  code?: string;
  reason?: string;
  sanitizedPrompt: string;
}

const HARD_DENY_PATTERNS: Array<{ pattern: RegExp; code: string; reason: string }> = [
  {
    pattern: /\b(process\.env|serviceacc\.json|x-salamanda-client-key|firebase_admin_private_key)\b/i,
    code: "NEWT-GATE-001",
    reason: "Request attempts to access protected server secrets or ambient credentials.",
  },
  {
    pattern: /\b(modify|edit|bypass|overwrite)\s+(firestore\.rules|salamanda\.toml|firebase\.json)\b/i,
    code: "NEWT-GATE-002",
    reason: "Limbs cannot modify canonical platform security rules or runtime configuration.",
  },
  {
    pattern: /ignore\s+(all\s+)?(previous|prior|system)\s+instructions/i,
    code: "NEWT-GATE-003",
    reason: "Prompt injection control override detected.",
  },
  {
    pattern: /\b(169\.254\.169\.254|metadata\.google\.internal)\b/i,
    code: "NEWT-GATE-004",
    reason: "Requests targeting cloud metadata or internal SSRF endpoints are forbidden.",
  },
];

const EXTERNAL_EXFIL_HINT = /\b(send|post|exfiltrate|upload|webhook|fetch|forward|leak)\b/i;

/**
 * Pre-agent security gatekeeper (`THREAT_MODEL.md` Adversary A2 / N-T1).
 * Strips pseudo-system delimiter tags and blocks obvious secret-exfiltration or
 * sensitive-collection + egress prompt injections before any LLM call runs.
 */
export function evaluatePromptSafety(
  rawPrompt: string,
  platformManifest: AmphibianPlatformManifest
): GatekeeperResult {
  const sanitizedPrompt = rawPrompt
    .replace(/<\/?(system|untrusted_page_data|assistant|tool_call)[^>]*>/gi, "")
    .trim();

  if (sanitizedPrompt.length === 0) {
    return {
      allowed: false,
      code: "NEWT-GATE-000",
      reason: "Prompt cannot be empty.",
      sanitizedPrompt: "",
    };
  }

  for (const rule of HARD_DENY_PATTERNS) {
    if (rule.pattern.test(sanitizedPrompt)) {
      return {
        allowed: false,
        code: rule.code,
        reason: rule.reason,
        sanitizedPrompt,
      };
    }
  }

  const sensitiveCollections =
    platformManifest.permissions_catalog?.sensitive_collections ?? [];
  for (const col of sensitiveCollections) {
    const escaped = col.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const mentionsSensitive = new RegExp(`\\b${escaped}\\b`, "i").test(sanitizedPrompt);
    if (mentionsSensitive && EXTERNAL_EXFIL_HINT.test(sanitizedPrompt)) {
      return {
        allowed: false,
        code: "NEWT-GATE-005",
        reason: `Request combines sensitive canonical collection '${col}' with external data transmission (SAL-PERM-001).`,
        sanitizedPrompt,
      };
    }
  }

  return {
    allowed: true,
    sanitizedPrompt,
  };
}

/**
 * Post-Architect deterministic policy check preventing L3 gate bypasses or
 * sensitive collection reads before code synthesis starts.
 */
export function evaluateBlueprintPolicy(
  blueprint: LimbBlueprint,
  platformManifest: AmphibianPlatformManifest,
  options: { enableL3?: boolean } = {}
): { allowed: boolean; code?: string; reason?: string } {
  const allowL3 =
    Boolean(options.enableL3) && platformManifest.runtime.allow_levels.includes(3);

  if (blueprint.level === 3 && !allowL3) {
    return {
      allowed: false,
      code: "NEWT-GATE-006",
      reason:
        "Level 3 (Full Source Variant) is currently gated off (see Task 6.1). Select Level 1 or Level 2.",
    };
  }

  const sensitive = new Set(
    platformManifest.permissions_catalog?.sensitive_collections ?? []
  );
  for (const col of blueprint.permissions.dataRead) {
    if (sensitive.has(col)) {
      return {
        allowed: false,
        code: "SAL-PERM-002",
        reason: `Blueprint requested sensitive collection '${col}', which is forbidden to Limbs.`,
      };
    }
  }

  return { allowed: true };
}
