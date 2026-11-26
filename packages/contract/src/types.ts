export const SALAMANDA_CONTRACT_VERSION = "1.0.0" as const;

export type ExtensionLevel = 1 | 2 | 3;
export type SidecarScope = "none" | "personal" | "shared" | "scratch";
export type UiIsolationMode = "iframe" | "same-origin-personal";
export type DiagnosticSeverity = "error" | "warning" | "info";
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface Diagnostic {
  code: string;
  severity: DiagnosticSeverity;
  path: string;
  message: string;
  hint?: string;
  suggested_fix?: string;
  doc_url?: string;
}

export interface ValidationReport {
  valid: boolean;
  limb_id: string;
  contract_version: string;
  diagnostics: Diagnostic[];
}

export interface WhoamiResponse {
  uid: string;
  issuer?: string;
}

export interface CapabilitiesResponse {
  contract_version: string;
  base: {
    name: string;
    framework: string;
  };
  allow_levels: ExtensionLevel[];
  features: Record<string, "stable" | "beta" | "experimental" | "disabled">;
  slots: string[];
  permissions_catalog: {
    data_read_scopes: string[];
    data_write_scopes: string[];
    sidecar_scopes: SidecarScope[];
  };
  limits: {
    max_memory_mb: number;
    max_cpu_ms: number;
    max_limbs_per_principal: number;
  };
}

export interface BaseSpec {
  base: {
    name: string;
    upstream: string;
    framework?: string;
  };
  extensions: {
    allow_levels: ExtensionLevel[];
    slots_manifest: string;
  };
  identity: {
    adapter: string;
    jwks_url?: string;
    issuer: string;
    audience: string;
    token_sources: string[];
  };
  data?: {
    canonical?: {
      mode: string;
      adapter: string;
      readable_collections?: string[];
      sensitive_collections?: string[];
    };
  };
  variants?: {
    install: string;
    build: string;
    start: string;
    health: string;
    edit_allow?: string[];
    edit_deny?: string[];
  };
}

export interface SlotDefinition {
  id: string;
  description: string;
  routes: string[];
  anchor_selector: string;
  placement?: "inside-start" | "inside-end" | "before" | "after";
  context_props?: string[];
}

export interface SlotsManifest {
  base: string;
  contract_version: string;
  slots: SlotDefinition[];
}

export interface LimbUiMount {
  slot: string;
  route_pattern?: string;
  component: string;
  style?: string;
  isolation: UiIsolationMode;
}

export interface LimbFunctionRoute {
  route: string;
  method: HttpMethod;
  handler: string;
}

export interface LimbPatchSpec {
  digest: string;
  diff_file?: string;
  touches: string[];
}

export interface LimbPermissions {
  data_read: string[];
  data_write: string[];
  egress: string[];
  sidecar: SidecarScope;
  max_memory_mb?: number;
  max_cpu_ms?: number;
}

export interface LimbManifest {
  limb: {
    id: string;
    name: string;
    version: string;
    level: ExtensionLevel;
    author: string;
    description?: string;
  };
  requires: {
    contract: string;
    base: string;
    base_compat?: string;
    slots?: string[];
  };
  ui?: LimbUiMount[];
  functions?: LimbFunctionRoute[];
  patch?: LimbPatchSpec;
  permissions: LimbPermissions;
  sidecar?: {
    migrations?: string;
  };
}

/**
 * Wire protocol (`newt.host.v1`) between `@newt/bridge` on any host platform
 * and Newt's `/embed` iframe drawer.
 */
export type NewtHostToEmbedMessage =
  | {
      protocol: "newt.host.v1";
      type: "newt.host.init";
      baseId: string;
      route: string;
      availableSlots: string[];
      selectedSlot?: string;
      theme: "light" | "dark";
      cssVars: Record<string, string>;
      userToken?: string | null;
    }
  | {
      protocol: "newt.host.v1";
      type: "newt.host.slot_picked";
      slotId: string;
      contextProps: Record<string, string>;
    }
  | {
      protocol: "newt.host.v1";
      type: "newt.host.route_changed";
      route: string;
      availableSlots: string[];
    }
  | {
      protocol: "newt.host.v1";
      type: "newt.host.token";
      userToken: string | null;
    };

export type NewtEmbedToHostMessage =
  | { protocol: "newt.host.v1"; type: "newt.embed.enter_slot_picker" }
  | { protocol: "newt.host.v1"; type: "newt.embed.exit_slot_picker" }
  | {
      protocol: "newt.host.v1";
      type: "newt.embed.preview_inline";
      slotId: string;
      limbId: string;
      compiledHtml: string;
    }
    | {
        protocol: "newt.host.v1";
        type: "newt.embed.binding_updated";
        limbIds: string[];
      }
    | {
        protocol: "newt.host.v1";
        type: "newt.embed.preview_live";
        limbId: string;
        bindings: string[];
      }
    | { protocol: "newt.host.v1"; type: "newt.embed.request_token" }
    | { protocol: "newt.host.v1"; type: "newt.embed.close_drawer" };
