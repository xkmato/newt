import { parse, stringify } from "smol-toml";
import {
  type BaseSpec,
  type CapabilitiesResponse,
  type LimbManifest,
  SALAMANDA_CONTRACT_VERSION,
  type SlotsManifest,
} from "./types.js";

export function parseBaseSpecToml(tomlStr: string): BaseSpec {
  const raw = parse(tomlStr) as unknown as BaseSpec;
  return {
    ...raw,
    base: {
      ...raw.base,
      framework: raw.base?.framework ?? "generic",
    },
  };
}

export function serializeBaseSpecToml(spec: BaseSpec): string {
  return stringify(spec as unknown as Record<string, unknown>);
}

export function parseLimbManifestToml(tomlStr: string): LimbManifest {
  const parsed = parse(tomlStr) as unknown as LimbManifest;
  if (!parsed || typeof parsed !== "object" || !parsed.limb || !parsed.requires || !parsed.permissions) {
    throw new Error("Missing required TOML sections ([limb], [requires], [permissions])");
  }
  return {
    ...parsed,
    ui: (parsed.ui ?? []).map((u) => ({
      ...u,
      route_pattern: u.route_pattern ?? "/*",
    })),
    functions: parsed.functions ?? [],
    permissions: {
      data_read: parsed.permissions.data_read ?? [],
      data_write: parsed.permissions.data_write ?? [],
      egress: parsed.permissions.egress ?? [],
      sidecar: parsed.permissions.sidecar,
      max_memory_mb: parsed.permissions.max_memory_mb ?? 64,
      max_cpu_ms: parsed.permissions.max_cpu_ms ?? 500,
    },
  };
}

export function serializeLimbManifestToml(manifest: LimbManifest): string {
  return stringify(manifest as unknown as Record<string, unknown>);
}

export function parseSlotsManifestJson(jsonStr: string): SlotsManifest {
  const raw = JSON.parse(jsonStr) as SlotsManifest;
  return {
    ...raw,
    slots: raw.slots.map((s) => ({
      ...s,
      placement: s.placement ?? "inside-end",
      context_props: s.context_props ?? [],
    })),
  };
}

/**
 * 1-to-1 TypeScript parity with `salamanda_core::CapabilitiesResponse::from_base_and_slots`.
 */
export function buildCapabilitiesResponse(
  base: BaseSpec,
  slots: SlotsManifest
): CapabilitiesResponse {
  const hasL3 = base.extensions.allow_levels.includes(3);
  return {
    contract_version: SALAMANDA_CONTRACT_VERSION,
    base: {
      name: base.base.name,
      framework: base.base.framework ?? "generic",
    },
    allow_levels: [...base.extensions.allow_levels],
    features: {
      l1_declarative_slots: "stable",
      l2_sandboxed_functions: "beta",
      l3_variant_runtime: hasL3 ? "experimental" : "disabled",
    },
    slots: slots.slots.map((s) => s.id),
    permissions_catalog: {
      data_read_scopes: [...(base.data?.canonical?.readable_collections ?? [])],
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
