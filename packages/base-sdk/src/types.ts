import type { BaseSpec, ExtensionLevel, SlotDefinition } from "@newt/contract";

export type SlotCardinality = "singleton" | "repeater";
export type AuthStrategy =
  | "host-token-callback"
  | "cookie-session"
  | "oidc-bearer"
  | "anonymous-dev";

export type SemanticThemeToken =
  | "--newt-bg"
  | "--newt-surface"
  | "--newt-card"
  | "--newt-fg"
  | "--newt-muted"
  | "--newt-primary"
  | "--newt-primary-fg"
  | "--newt-accent"
  | "--newt-accent-fg"
  | "--newt-border"
  | "--newt-ring"
  | "--newt-radius";

export interface PortableSlotSpec extends SlotDefinition {
  cardinality: SlotCardinality;
}

export interface ThemeSpec {
  dark_mode_selector?: string;
  tokens: Partial<Record<SemanticThemeToken, string>> & Record<string, string>;
  light_fallbacks?: Record<string, string>;
  dark_fallbacks?: Record<string, string>;
}

export interface CanonicalEntitySpec {
  description: string;
  fields: Record<string, string>;
}

export interface AmphibianPlatformManifest {
  $schema?: string;
  contract_version: string;
  base: {
    id: string;
    name: string;
    framework: string;
    origin?: string;
    description?: string;
  };
  runtime: {
    allow_levels: ExtensionLevel[];
    supports_client_only_hydration?: boolean;
    health_path?: string;
  };
  auth: {
    strategy: AuthStrategy;
    ssr_cookie?: string;
    login_path?: string;
  };
  theme: ThemeSpec;
  slots: PortableSlotSpec[];
  permissions_catalog?: {
    readable_collections?: string[];
    sensitive_collections?: string[];
  };
  canonical_entities?: Record<string, CanonicalEntitySpec>;
}

export interface BasePack<TFixtures = Record<string, unknown[]>> {
  manifest: AmphibianPlatformManifest;
  baseSpec: BaseSpec;
  fixtures: TFixtures;
}
