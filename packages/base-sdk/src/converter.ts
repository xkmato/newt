import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  type CapabilitiesResponse,
  type ExtensionLevel,
  SALAMANDA_CONTRACT_VERSION,
  type SlotsManifest,
} from "@newt/contract";
import type { AmphibianPlatformManifest, ThemeSpec } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.resolve(__dirname, "../schemas/platform-manifest.schema.json");
const platformSchema = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8")) as Record<
  string,
  unknown
>;

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validatePlatformFn = ajv.compile(platformSchema);

export function validatePlatformManifest(manifest: unknown): {
  valid: boolean;
  errors: string[];
} {
  const ok = Boolean(validatePlatformFn(manifest));
  const errors = (validatePlatformFn.errors ?? []).map(
    (e) => `${e.instancePath || "/"}: ${e.message ?? "invalid"}`
  );
  return { valid: ok, errors };
}

/**
 * Converts a portable `AmphibianPlatformManifest` into a Salamanda `slots.json` manifest
 * (`contract/slots.schema.json`).
 */
export function toSalamandaSlotsManifest(
  manifest: AmphibianPlatformManifest
): SlotsManifest {
  return {
    base: manifest.base.id,
    contract_version: manifest.contract_version,
    slots: manifest.slots.map((s) => ({
      id: s.id,
      description: s.description,
      routes: [...s.routes],
      anchor_selector: s.anchor_selector,
      placement: s.placement ?? "inside-end",
      context_props: [...(s.context_props ?? [])],
    })),
  };
}

/**
 * Builds an offline Salamanda `CapabilitiesResponse` directly from a platform manifest
 * when running Newt Studio in standalone mode without a live Salamanda daemon.
 * Note: Level 3 remains gated behind `options.enableL3` by default (`NEWT-DECISION-002`).
 */
export function toCapabilitiesResponse(
  manifest: AmphibianPlatformManifest,
  options: { enableL3?: boolean } = {}
): CapabilitiesResponse {
  const effectiveLevels: ExtensionLevel[] = manifest.runtime.allow_levels.filter(
    (lvl) => lvl !== 3 || Boolean(options.enableL3)
  );
  const hasL3 = effectiveLevels.includes(3);

  return {
    contract_version: SALAMANDA_CONTRACT_VERSION,
    base: {
      name: manifest.base.id,
      framework: manifest.base.framework,
    },
    allow_levels: effectiveLevels.length > 0 ? effectiveLevels : [1, 2],
    features: {
      l1_declarative_slots: "stable",
      l2_sandboxed_functions: effectiveLevels.includes(2) ? "beta" : "disabled",
      l3_variant_runtime: hasL3 ? "experimental" : "disabled",
    },
    slots: manifest.slots.map((s) => s.id),
    permissions_catalog: {
      data_read_scopes: [...(manifest.permissions_catalog?.readable_collections ?? [])],
      data_write_scopes: [],
      sidecar_scopes: ["none", "personal", "shared", "scratch"],
    },
    limits: {
      max_memory_mb: 256,
      max_cpu_ms: 5000,
      max_limbs_per_principal: 8,
    },
  };
}

const DEFAULT_LIGHT_TOKENS: Record<string, string> = {
  "--newt-bg": "oklch(1 0 0)",
  "--newt-surface": "oklch(0.97 0 0)",
  "--newt-card": "oklch(1 0 0)",
  "--newt-fg": "oklch(0.145 0 0)",
  "--newt-muted": "oklch(0.556 0 0)",
  "--newt-primary": "oklch(0.205 0 0)",
  "--newt-primary-fg": "oklch(0.985 0 0)",
  "--newt-accent": "oklch(0.97 0 0)",
  "--newt-accent-fg": "oklch(0.205 0 0)",
  "--newt-border": "oklch(0.922 0 0)",
  "--newt-ring": "oklch(0.708 0 0)",
  "--newt-radius": "0.625rem",
};

const DEFAULT_DARK_TOKENS: Record<string, string> = {
  "--newt-bg": "oklch(0.145 0 0)",
  "--newt-surface": "oklch(0.269 0 0)",
  "--newt-card": "oklch(0.205 0 0)",
  "--newt-fg": "oklch(0.985 0 0)",
  "--newt-muted": "oklch(0.708 0 0)",
  "--newt-primary": "oklch(0.922 0 0)",
  "--newt-primary-fg": "oklch(0.205 0 0)",
  "--newt-accent": "oklch(0.269 0 0)",
  "--newt-accent-fg": "oklch(0.985 0 0)",
  "--newt-border": "oklch(1 0 0 / 10%)",
  "--newt-ring": "oklch(0.556 0 0)",
  "--newt-radius": "0.625rem",
};

/**
 * Generates portable semantic CSS variables (`--newt-*`) with host variable bindings
 * and light/dark fallbacks so compiled `srcdoc` Limb UIs match any host platform out of the box.
 */
export function compileThemeTokenStylesheet(theme: ThemeSpec): string {
  const lightLines: string[] = [];
  const darkLines: string[] = [];

  const allSemanticKeys = new Set([
    ...Object.keys(DEFAULT_LIGHT_TOKENS),
    ...Object.keys(theme.tokens),
  ]);

  for (const newtVar of allSemanticKeys) {
    const hostVar = theme.tokens[newtVar];
    const lightFallback =
      (hostVar ? theme.light_fallbacks?.[hostVar] : undefined) ??
      theme.light_fallbacks?.[newtVar] ??
      DEFAULT_LIGHT_TOKENS[newtVar] ??
      "inherit";
    const darkFallback =
      (hostVar ? theme.dark_fallbacks?.[hostVar] : undefined) ??
      theme.dark_fallbacks?.[newtVar] ??
      DEFAULT_DARK_TOKENS[newtVar] ??
      lightFallback;

    if (hostVar && hostVar.startsWith("--")) {
      lightLines.push(`  ${newtVar}: var(${hostVar}, ${lightFallback});`);
      darkLines.push(`  ${newtVar}: var(${hostVar}, ${darkFallback});`);
    } else {
      lightLines.push(`  ${newtVar}: ${hostVar ?? lightFallback};`);
      darkLines.push(`  ${newtVar}: ${darkFallback};`);
    }
  }

  return [
    ":root {",
    ...lightLines,
    "}",
    '@media (prefers-color-scheme: dark) {',
    "  :root:not([data-newt-theme=\"light\"]) {",
    ...darkLines.map((l) => `  ${l}`),
    "  }",
    "}",
    ':root[data-newt-theme="dark"], .dark {',
    ...darkLines,
    "}",
  ].join("\n");
}

/**
 * Renders a deterministic, platform-agnostic prompt specification for `@newt/agents`
 * so zero hardcoded platform names, slot IDs, or collection schemas exist in agent code.
 */
export function formatPlatformContextForAgent(
  manifest: AmphibianPlatformManifest,
  options: { enableL3?: boolean } = {}
): string {
  const caps = toCapabilitiesResponse(manifest, options);
  const slotLines = manifest.slots.map(
    (s) =>
      `- \`${s.id}\` (${s.cardinality}, routes: ${s.routes.join(", ")}, props: [${(s.context_props ?? []).join(", ")}]): ${s.description}`
  );
  const entityLines = Object.entries(manifest.canonical_entities ?? {}).map(
    ([name, spec]) => {
      const fields = Object.entries(spec.fields)
        .map(([k, v]) => `${k}: ${v}`)
        .join(", ");
      return `- \`${name}\`: ${spec.description} — { ${fields} }`;
    }
  );

  const sensitive = manifest.permissions_catalog?.sensitive_collections ?? [];
  const tokenMappings = Object.entries(manifest.theme.tokens)
    .map(([newtVar, hostVar]) => `${newtVar} -> ${hostVar}`)
    .join(", ");

  return [
    `# Target Base Platform: ${manifest.base.name} (\`base = "${manifest.base.id}"\`)`,
    `- Framework: ${manifest.base.framework}`,
    `- Enabled Extension Levels: [${caps.allow_levels.join(", ")}]`,
    `- Readable Canonical Collections: [${caps.permissions_catalog.data_read_scopes.join(", ")}]`,
    ...(sensitive.length > 0
      ? [`- Forbidden Sensitive Collections (NEVER read): [${sensitive.join(", ")}]`]
      : []),
    `- Theme Dark Mode Selector: ${manifest.theme.dark_mode_selector ?? "html.dark"}`,
    `- Theme Token Map: ${tokenMappings || Object.keys(DEFAULT_LIGHT_TOKENS).join(", ")}`,
    `- Semantic CSS Variables Available: ${Object.keys(DEFAULT_LIGHT_TOKENS).join(", ")}`,
    "",
    "## Available Named Slots",
    ...slotLines,
    ...(entityLines.length > 0 ? ["", "## Canonical Read-Only Entities", ...entityLines] : []),
  ].join("\n");
}
