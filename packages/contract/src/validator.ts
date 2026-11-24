import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { parseLimbManifestToml } from "./toml.js";
import {
  type BaseSpec,
  type Diagnostic,
  type LimbManifest,
  SALAMANDA_CONTRACT_VERSION,
  type SlotsManifest,
  type ValidationReport,
} from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMAS_DIR = path.resolve(__dirname, "../schemas");

function loadJsonSchema(filename: string): Record<string, unknown> {
  const fullPath = path.join(SCHEMAS_DIR, filename);
  return JSON.parse(fs.readFileSync(fullPath, "utf8")) as Record<string, unknown>;
}

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

const limbJsonSchema = loadJsonSchema("limb.schema.json");
const slotsJsonSchema = loadJsonSchema("slots.schema.json");
const validateLimbSchemaFn = ajv.compile(limbJsonSchema);
const validateSlotsSchemaFn = ajv.compile(slotsJsonSchema);

export function validateSlotsManifestSchema(slots: unknown): {
  valid: boolean;
  errors: string[];
} {
  const ok = Boolean(validateSlotsSchemaFn(slots));
  const errors = (validateSlotsSchemaFn.errors ?? []).map(
    (e) => `${e.instancePath || "/"}: ${e.message ?? "invalid"}`
  );
  return { valid: ok, errors };
}

function isForbiddenEgressHost(host: string): boolean {
  const lower = host.toLowerCase();
  return (
    lower === "localhost" ||
    lower === "127.0.0.1" ||
    lower === "::1" ||
    lower === "0.0.0.0" ||
    lower === "169.254.169.254" ||
    lower.startsWith("10.") ||
    lower.startsWith("192.168.") ||
    lower.startsWith("172.16.") ||
    lower.endsWith(".local") ||
    lower.endsWith(".internal")
  );
}

function matchesGlobPrefix(filePath: string, pattern: string): boolean {
  const prefix = pattern.replace(/\*+$/, "");
  return filePath === pattern || (prefix.length > 0 && filePath.startsWith(prefix));
}

/**
 * 100% parity TypeScript offline port of `salamanda-core::LimbManifest::validate` +
 * `contract/limb.schema.json` checks so Newt agents and standalone Studio validate
 * Limbs identically whether Salamanda's Control Plane is online or offline.
 */
export function validateLimbManifest(
  manifest: LimbManifest,
  base: BaseSpec,
  slots: SlotsManifest,
  isSharedPublication = false
): ValidationReport {
  const diagnostics: Diagnostic[] = [];

  // 0. Check limb.id pattern (`SAL-SCHEMA-001`)
  const idRegex = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;
  if (!idRegex.test(manifest.limb.id)) {
    diagnostics.push({
      code: "SAL-SCHEMA-001",
      severity: "error",
      path: "limb.id",
      message: `Invalid limb.id '${manifest.limb.id}': must be 3..=64 lowercase alphanumeric or hyphen chars.`,
      hint: "Conforms to pattern ^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$ in limb.schema.json.",
      suggested_fix: "Use a lowercase slug such as `luganda-tts`.",
    });
  }

  // Additional JSON Schema checks against `contract/limb.schema.json`
  const schemaOk = Boolean(validateLimbSchemaFn(manifest));
  if (!schemaOk && diagnostics.length === 0) {
    for (const err of validateLimbSchemaFn.errors ?? []) {
      const dottedPath = (err.instancePath || "")
        .replace(/^\//, "")
        .replace(/\//g, ".");
      diagnostics.push({
        code: "SAL-SCHEMA-001",
        severity: "error",
        path: dottedPath || "limb.toml",
        message: `Schema violation at '${dottedPath || "root"}': ${err.message ?? "invalid value"}`,
        hint: "Manifest must conform to contract/limb.schema.json.",
      });
    }
  }

  // 1. Check extension level support (`SAL-LEVEL-001`)
  if (!base.extensions.allow_levels.includes(manifest.limb.level)) {
    diagnostics.push({
      code: "SAL-LEVEL-001",
      severity: "error",
      path: "limb.level",
      message: `Extension level ${manifest.limb.level} is not enabled on base '${base.base.name}'`,
      hint: `Base '${base.base.name}' allows levels: [${base.extensions.allow_levels.join(", ")}]`,
      suggested_fix: "Set `level = 1` or `level = 2` in [limb].",
    });
  }

  // 2 & 3. Check requested slots exist (`SAL-SLOT-001`) & shared iframe rule (`SAL-UI-001`)
  const validSlotIds = slots.slots.map((s) => s.id);
  const uiMounts = manifest.ui ?? [];
  uiMounts.forEach((uiMount, idx) => {
    if (!validSlotIds.includes(uiMount.slot)) {
      diagnostics.push({
        code: "SAL-SLOT-001",
        severity: "error",
        path: `ui[${idx}].slot`,
        message: `Unknown slot '${uiMount.slot}' for base '${base.base.name}'`,
        hint: "Limbs must mount into stable named slots declared in slots.json.",
        suggested_fix: `Choose one of: ${validSlotIds.join(", ")}`,
      });
    }

    if (isSharedPublication && uiMount.isolation !== "iframe") {
      diagnostics.push({
        code: "SAL-UI-001",
        severity: "error",
        path: `ui[${idx}].isolation`,
        message:
          'Shared limbs must use `isolation = "iframe"` to prevent same-origin session hijacking.',
        hint: "Same-origin execution is only permitted for unshared personal drafts.",
        suggested_fix: 'isolation = "iframe"',
      });
    }
  });

  // 4. Check function route prefixes (`SAL-ROUTE-001`)
  const expectedPrefix = `/_limb/${manifest.limb.id}/`;
  const funcs = manifest.functions ?? [];
  funcs.forEach((func, idx) => {
    if (!func.route.startsWith(expectedPrefix)) {
      diagnostics.push({
        code: "SAL-ROUTE-001",
        severity: "error",
        path: `functions[${idx}].route`,
        message: `Function route '${func.route}' must start with '${expectedPrefix}'`,
        hint: "All Level 2 function routes are namespaced under /_limb/<limb.id>/.",
        suggested_fix: `route = "${expectedPrefix}${func.route.replace(/^\/+/, "")}"`,
      });
    }
  });

  // 5. Check egress hostnames for forbidden internal/metadata addresses (`SAL-EGRESS-001`)
  manifest.permissions.egress.forEach((host, idx) => {
    if (isForbiddenEgressHost(host)) {
      diagnostics.push({
        code: "SAL-EGRESS-001",
        severity: "error",
        path: `permissions.egress[${idx}]`,
        message: `Egress target '${host}' is a forbidden internal, loopback, or cloud metadata host.`,
        hint: "Limbs may only declare public external domain names in permissions.egress.",
        suggested_fix: `Remove '${host}' from \`permissions.egress\`.`,
      });
    }
  });

  // Check L1 declaring functions or egress (`SAL-LEVEL-002`)
  if (
    manifest.limb.level === 1 &&
    (funcs.length > 0 || manifest.permissions.egress.length > 0)
  ) {
    diagnostics.push({
      code: "SAL-LEVEL-002",
      severity: "error",
      path: "limb.level",
      message:
        "Level 1 (Declarative) limbs cannot declare server [[functions]] or external `egress`.",
      hint: "Upgrade to `level = 2` if backend functions or external API calls are required.",
      suggested_fix:
        "Set `level = 2` in [limb], or remove [[functions]] and `permissions.egress`.",
    });
  }

  // 6. Check toxic permission combinations (`SAL-PERM-001` & `SAL-PERM-002`)
  const sensitive = base.data?.canonical?.sensitive_collections ?? [];
  const readable = base.data?.canonical?.readable_collections ?? [];
  for (const scope of manifest.permissions.data_read) {
    if (sensitive.includes(scope)) {
      if (manifest.permissions.egress.length > 0) {
        diagnostics.push({
          code: "SAL-PERM-001",
          severity: "error",
          path: "permissions",
          message: `Toxic permission combination: reading sensitive collection '${scope}' while enabling external egress [${manifest.permissions.egress.join(", ")}] is forbidden.`,
          hint: "Prevent indirect prompt injection from exfiltrating private data over external HTTP.",
          suggested_fix: `Remove '${scope}' from \`permissions.data_read\` or set \`permissions.egress = []\`.`,
        });
      } else {
        diagnostics.push({
          code: "SAL-PERM-002",
          severity: "error",
          path: "permissions.data_read",
          message: `Collection '${scope}' is marked sensitive and cannot be read by limbs.`,
          hint: `Readable collections: [${readable.join(", ")}]`,
          suggested_fix: `Remove '${scope}' from \`data_read\`.`,
        });
      }
    }
  }

  // 7. Check Level 3 source patch edit policy (`SAL-EDIT-001` & `SAL-PATCH-001`)
  if (manifest.limb.level === 3) {
    if (manifest.patch) {
      const defaultDeny = [".env*", "firestore.rules", "firebase.json", "salamanda.toml"];
      const denyPatterns = Array.from(
        new Set([...defaultDeny, ...(base.variants?.edit_deny ?? [])])
      );
      const allowPatterns = base.variants?.edit_allow ?? [];
      for (const touched of manifest.patch.touches) {
        const normalized = touched.replace(/^\.?\//, "");
        const hasTraversal = normalized.split("/").includes("..");
        const denied =
          hasTraversal || denyPatterns.some((pat) => matchesGlobPrefix(normalized, pat));
        if (denied) {
          diagnostics.push({
            code: "SAL-EDIT-001",
            severity: "error",
            path: "patch.touches",
            message: `Patch modifies protected file '${touched}' which matches base edit_deny policy.`,
            hint: "Variants cannot modify secrets, security rules, or salamanda.toml.",
            suggested_fix: `Revert changes to '${touched}'.`,
          });
          continue;
        }
        if (allowPatterns.length > 0) {
          const allowed = allowPatterns.some((pat) => matchesGlobPrefix(normalized, pat));
          if (!allowed) {
            diagnostics.push({
              code: "SAL-EDIT-001",
              severity: "error",
              path: "patch.touches",
              message: `Patch modifies file '${touched}' outside base edit_allow policy [${allowPatterns.join(", ")}].`,
              hint: "Level 3 patches may only touch files allowed by [variants].edit_allow.",
              suggested_fix: `Restrict patch edits to allowed paths (${allowPatterns.join(", ")}).`,
            });
          }
        }
      }
    } else {
      diagnostics.push({
        code: "SAL-PATCH-001",
        severity: "error",
        path: "patch",
        message: "Level 3 limbs must include a [patch] section.",
        suggested_fix: "Add `[patch]` with `digest` and `touches`.",
      });
    }
  }

  const valid = !diagnostics.some((d) => d.severity === "error");
  return {
    valid,
    limb_id: manifest.limb.id,
    contract_version: SALAMANDA_CONTRACT_VERSION,
    diagnostics,
  };
}

export function validateLimbManifestToml(
  manifestToml: string,
  base: BaseSpec,
  slots: SlotsManifest,
  isSharedPublication = false
): ValidationReport {
  try {
    const manifest = parseLimbManifestToml(manifestToml);
    return validateLimbManifest(manifest, base, slots, isSharedPublication);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      valid: false,
      limb_id: "unknown",
      contract_version: SALAMANDA_CONTRACT_VERSION,
      diagnostics: [
        {
          code: "SAL-TOML-001",
          severity: "error",
          path: "limb.toml",
          message: `TOML syntax or schema error: ${message}`,
          hint: "Ensure all required sections ([limb], [requires], [permissions]) are valid TOML.",
        },
      ],
    };
  }
}
