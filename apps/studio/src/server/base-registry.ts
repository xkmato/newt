import {
  type AmphibianPlatformManifest,
  type BasePack,
  synthesizeManifestFromHtml,
  toCapabilitiesResponse,
  toSalamandaSlotsManifest,
  validatePlatformManifest,
} from "@newt/base-sdk";
import { xkmatoBasePack } from "@newt/base-xkmato";
import type { BaseSpec, CapabilitiesResponse, SlotsManifest } from "@newt/contract";

export const standalonePlatformManifest: AmphibianPlatformManifest = {
  $schema: "https://amphibian.dev/schemas/v1/platform-manifest.schema.json",
  contract_version: "1.0.0",
  base: {
    id: "standalone",
    name: "Standalone UI Canvas",
    framework: "preact-standalone",
    origin: "https://studio.newt.local",
    description:
      "Isolated standalone widget canvas for prototyping portable UI components without binding to a specific host platform.",
  },
  runtime: {
    allow_levels: [1, 2],
    supports_client_only_hydration: true,
    health_path: "/api/v1/health",
  },
  auth: {
    strategy: "anonymous-dev",
  },
  theme: {
    dark_mode_selector: "html.dark",
    tokens: {
      "--newt-bg": "--studio-canvas-bg",
      "--newt-surface": "--studio-canvas-surface",
      "--newt-card": "--studio-canvas-card",
      "--newt-fg": "--studio-canvas-fg",
      "--newt-muted": "--studio-canvas-muted",
      "--newt-primary": "--studio-canvas-primary",
      "--newt-primary-fg": "--studio-canvas-primary-fg",
      "--newt-accent": "--studio-canvas-accent",
      "--newt-accent-fg": "--studio-canvas-accent-fg",
      "--newt-border": "--studio-canvas-border",
      "--newt-ring": "--studio-canvas-ring",
      "--newt-radius": "--studio-canvas-radius",
    },
    light_fallbacks: {
      "--studio-canvas-bg": "oklch(0.99 0 0)",
      "--studio-canvas-surface": "oklch(0.96 0.005 260)",
      "--studio-canvas-card": "oklch(1 0 0)",
      "--studio-canvas-fg": "oklch(0.16 0.01 260)",
      "--studio-canvas-muted": "oklch(0.52 0.015 260)",
      "--studio-canvas-primary": "oklch(0.47 0.16 165)",
      "--studio-canvas-primary-fg": "oklch(0.99 0 0)",
      "--studio-canvas-accent": "oklch(0.94 0.02 165)",
      "--studio-canvas-accent-fg": "oklch(0.24 0.06 165)",
      "--studio-canvas-border": "oklch(0.89 0.01 260)",
      "--studio-canvas-ring": "oklch(0.6 0.14 165)",
      "--studio-canvas-radius": "0.75rem",
    },
    dark_fallbacks: {
      "--studio-canvas-bg": "oklch(0.145 0.01 260)",
      "--studio-canvas-surface": "oklch(0.21 0.012 260)",
      "--studio-canvas-card": "oklch(0.19 0.012 260)",
      "--studio-canvas-fg": "oklch(0.96 0.005 260)",
      "--studio-canvas-muted": "oklch(0.71 0.015 260)",
      "--studio-canvas-primary": "oklch(0.74 0.14 165)",
      "--studio-canvas-primary-fg": "oklch(0.15 0.02 165)",
      "--studio-canvas-accent": "oklch(0.26 0.03 165)",
      "--studio-canvas-accent-fg": "oklch(0.93 0.04 165)",
      "--studio-canvas-border": "oklch(1 0 0 / 12%)",
      "--studio-canvas-ring": "oklch(0.74 0.14 165)",
      "--studio-canvas-radius": "0.75rem",
    },
  },
  slots: [
    {
      id: "standalone.canvas",
      cardinality: "singleton",
      description: "Primary isolated component viewport in Standalone UI Mode.",
      routes: ["/*"],
      anchor_selector: '[data-salamanda-slot="standalone.canvas"]',
      placement: "inside-end",
      context_props: ["viewport", "widget-title"],
    },
  ],
  permissions_catalog: {
    readable_collections: [],
    sensitive_collections: [],
  },
  canonical_entities: {},
};

export const standaloneBaseSpec: BaseSpec = {
  base: {
    name: "standalone",
    upstream: "http://127.0.0.1:3100",
    framework: "preact-standalone",
  },
  extensions: {
    allow_levels: [1, 2],
    slots_manifest: "slots.json",
  },
  identity: {
    adapter: "dev-header",
    issuer: "https://studio.newt.local",
    audience: "standalone",
    token_sources: ["header:x-newt-uid"],
  },
  data: {
    canonical: {
      mode: "none",
      adapter: "none",
      readable_collections: [],
      sensitive_collections: [],
    },
  },
};

export const standaloneBasePack: BasePack<Record<string, Array<Record<string, unknown>>>> = {
  manifest: standalonePlatformManifest,
  baseSpec: standaloneBaseSpec,
  fixtures: {},
};

export function baseSpecFromManifest(manifest: AmphibianPlatformManifest): BaseSpec {
  return {
    base: {
      name: manifest.base.id,
      upstream: manifest.base.origin ?? "http://127.0.0.1:3000",
      framework: manifest.base.framework,
    },
    extensions: {
      allow_levels: manifest.runtime.allow_levels,
      slots_manifest: "slots.json",
    },
    identity: {
      adapter: manifest.auth.strategy === "anonymous-dev" ? "dev-header" : "jwt",
      issuer: manifest.base.origin ?? `https://${manifest.base.id}.local`,
      audience: manifest.base.id,
      token_sources: manifest.auth.ssr_cookie
        ? [`cookie:${manifest.auth.ssr_cookie}`, "header:authorization"]
        : ["header:authorization"],
    },
    data: {
      canonical: {
        mode: "base-api",
        adapter: "bearer",
        readable_collections: [...(manifest.permissions_catalog?.readable_collections ?? [])],
        sensitive_collections: [...(manifest.permissions_catalog?.sensitive_collections ?? [])],
      },
    },
  };
}

export interface SerializedBasePack {
  id: string;
  builtIn: boolean;
  manifest: AmphibianPlatformManifest;
  baseSpec: BaseSpec;
  slotsManifest: SlotsManifest;
  capabilities: CapabilitiesResponse;
  fixtures: Record<string, Array<Record<string, unknown>>>;
}

export class BaseRegistry {
  private readonly packs = new Map<
    string,
    {
      builtIn: boolean;
      pack: BasePack<Record<string, Array<Record<string, unknown>>>>;
    }
  >();

  constructor() {
    this.packs.set(xkmatoBasePack.manifest.base.id, {
      builtIn: true,
      pack: xkmatoBasePack as unknown as BasePack<Record<string, Array<Record<string, unknown>>>>,
    });
    this.packs.set(standaloneBasePack.manifest.base.id, {
      builtIn: true,
      pack: standaloneBasePack,
    });
  }

  get(baseId: string): BasePack<Record<string, Array<Record<string, unknown>>>> | null {
    return this.packs.get(baseId)?.pack ?? null;
  }

  list(): SerializedBasePack[] {
    return Array.from(this.packs.values()).map(({ builtIn, pack }) => ({
      id: pack.manifest.base.id,
      builtIn,
      manifest: pack.manifest,
      baseSpec: pack.baseSpec,
      slotsManifest: toSalamandaSlotsManifest(pack.manifest),
      capabilities: toCapabilitiesResponse(pack.manifest),
      fixtures: pack.fixtures,
    }));
  }

  registerManifest(
    manifest: AmphibianPlatformManifest,
    fixtures: Record<string, Array<Record<string, unknown>>> = {}
  ): SerializedBasePack {
    const check = validatePlatformManifest(manifest);
    if (!check.valid) {
      throw new Error(`Invalid AmphibianPlatformManifest: ${check.errors.join("; ")}`);
    }
    const pack: BasePack<Record<string, Array<Record<string, unknown>>>> = {
      manifest,
      baseSpec: baseSpecFromManifest(manifest),
      fixtures,
    };
    this.packs.set(manifest.base.id, { builtIn: false, pack });
    return {
      id: manifest.base.id,
      builtIn: false,
      manifest,
      baseSpec: pack.baseSpec,
      slotsManifest: toSalamandaSlotsManifest(manifest),
      capabilities: toCapabilitiesResponse(manifest),
      fixtures,
    };
  }

  async inspectAndRegisterUrl(targetUrl: string): Promise<{
    source: "well-known" | "html-auto-inspect";
    base: SerializedBasePack;
  }> {
    const parsed = new URL(targetUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("Only http:// and https:// URLs can be inspected");
    }

    const wellKnownUrl = new URL("/.well-known/amphibian.json", parsed.origin).toString();
    try {
      const wkRes = await fetch(wellKnownUrl, { signal: AbortSignal.timeout(6000) });
      if (wkRes.ok) {
        const manifest = (await wkRes.json()) as AmphibianPlatformManifest;
        const base = this.registerManifest(manifest);
        return { source: "well-known", base };
      }
    } catch {
      // Fall through to HTML auto-inspection
    }

    const htmlRes = await fetch(targetUrl, { signal: AbortSignal.timeout(8000) });
    if (!htmlRes.ok) {
      throw new Error(`Failed to fetch '${targetUrl}' (HTTP ${htmlRes.status})`);
    }
    const html = await htmlRes.text();
    const manifest = synthesizeManifestFromHtml(targetUrl, html);
    const base = this.registerManifest(manifest);
    return { source: "html-auto-inspect", base };
  }
}
