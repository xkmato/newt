import { describe, expect, it } from "vitest";
import { validateSlotsManifestSchema } from "@newt/contract";
import {
  type AmphibianPlatformManifest,
  compileThemeTokenStylesheet,
  formatPlatformContextForAgent,
  synthesizeManifestFromHtml,
  toCapabilitiesResponse,
  toSalamandaSlotsManifest,
  validatePlatformManifest,
} from "../src/index.js";

const GENERIC_FORUM_MANIFEST: AmphibianPlatformManifest = {
  contract_version: "1.0.0",
  base: {
    id: "indie-forum",
    name: "Indie Forum",
    framework: "express-htmx",
    origin: "https://forum.example.org",
  },
  runtime: {
    allow_levels: [1, 2, 3],
    supports_client_only_hydration: true,
  },
  auth: {
    strategy: "oidc-bearer",
  },
  theme: {
    dark_mode_selector: "[data-theme='dark']",
    tokens: {
      "--newt-bg": "--forum-surface",
      "--newt-fg": "--forum-ink",
    },
    light_fallbacks: {
      "--forum-surface": "#ffffff",
      "--forum-ink": "#111827",
    },
    dark_fallbacks: {
      "--forum-surface": "#0f172a",
      "--forum-ink": "#f8fafc",
    },
  },
  slots: [
    {
      id: "thread.header",
      cardinality: "singleton",
      description: "Top of a discussion thread.",
      routes: ["/t/*"],
      anchor_selector: '[data-salamanda-slot="thread.header"]',
      context_props: ["thread-id"],
    },
    {
      id: "reply.actions",
      cardinality: "repeater",
      description: "Action bar inside every reply item.",
      routes: ["/t/*"],
      anchor_selector: '[data-salamanda-slot="reply.actions"]',
      context_props: ["reply-id", "author-handle"],
    },
  ],
  permissions_catalog: {
    readable_collections: ["threads", "replies"],
    sensitive_collections: ["private_messages"],
  },
  canonical_entities: {
    threads: {
      description: "Public forum threads.",
      fields: { id: "string", title: "string", body: "string" },
    },
  },
};

describe("@newt/base-sdk cross-platform portability", () => {
  it("validates arbitrary non-XKMato platform manifests and converts to Salamanda slots.json", () => {
    const check = validatePlatformManifest(GENERIC_FORUM_MANIFEST);
    expect(check.valid).toBe(true);

    const slotsJson = toSalamandaSlotsManifest(GENERIC_FORUM_MANIFEST);
    expect(validateSlotsManifestSchema(slotsJson).valid).toBe(true);
    expect(slotsJson.slots.map((s) => s.id)).toEqual(["thread.header", "reply.actions"]);
  });

  it("gates Level 3 by default until enableL3 is explicitly opened (NEWT-DECISION-002)", () => {
    const defaultCaps = toCapabilitiesResponse(GENERIC_FORUM_MANIFEST);
    expect(defaultCaps.allow_levels).toEqual([1, 2]);
    expect(defaultCaps.features.l3_variant_runtime).toBe("disabled");

    const unlockedCaps = toCapabilitiesResponse(GENERIC_FORUM_MANIFEST, { enableL3: true });
    expect(unlockedCaps.allow_levels).toEqual([1, 2, 3]);
    expect(unlockedCaps.features.l3_variant_runtime).toBe("experimental");
  });

  it("compiles semantic --newt-* theme tokens and formats dynamic LLM agent context", () => {
    const css = compileThemeTokenStylesheet(GENERIC_FORUM_MANIFEST.theme);
    expect(css).toContain("--newt-bg: var(--forum-surface, #ffffff);");
    expect(css).toContain("--newt-bg: var(--forum-surface, #0f172a);");

    const prompt = formatPlatformContextForAgent(GENERIC_FORUM_MANIFEST);
    expect(prompt).toContain('base = "indie-forum"');
    expect(prompt).toContain("`reply.actions` (repeater");
    expect(prompt).toContain("`threads`: Public forum threads.");
  });

  it("auto-synthesizes a working manifest from raw HTML landmarks and CSS custom properties", () => {
    const rawHtml = `
      <!DOCTYPE html>
      <html>
        <head><style>:root { --bg-primary: #fff; --bg-card: #f9f9f9; --accent: #ff6600; }</style></head>
        <body><main><article><h1>Hello World</h1></article><aside>Links</aside></main></body>
      </html>
    `;
    const autoManifest = synthesizeManifestFromHtml("https://blog.example.com/posts/1", rawHtml);
    expect(validatePlatformManifest(autoManifest).valid).toBe(true);
    expect(autoManifest.slots.map((s) => s.id)).toContain("article.header");
    expect(autoManifest.slots.map((s) => s.id)).toContain("page.sidebar");
    expect(autoManifest.theme.tokens["--newt-bg"]).toBe("--bg-primary");
  });
});
