import type { AmphibianPlatformManifest, PortableSlotSpec } from "./types.js";

const LANDMARK_CANDIDATES: Array<{
  tag: string;
  slotId: string;
  description: string;
}> = [
  {
    tag: "article",
    slotId: "article.header",
    description: "Synthesized slot at the start of the primary <article> landmark.",
  },
  {
    tag: "aside",
    slotId: "page.sidebar",
    description: "Synthesized companion slot inside <aside>.",
  },
  {
    tag: "main",
    slotId: "main.header",
    description: "Synthesized slot at the top of <main>.",
  },
  {
    tag: "footer",
    slotId: "page.footer",
    description: "Synthesized slot above <footer>.",
  },
];

/**
 * Zero-config semantic landmark & CSS custom property inspector (`newt inspect-url`).
 * Allows Newt Studio to prototype Limbs on an unmodified external website before
 * explicit `<amphibian-slot>` tags or `/.well-known/amphibian.json` are added.
 */
export function synthesizeManifestFromHtml(
  targetUrl: string,
  html: string
): AmphibianPlatformManifest {
  const parsedUrl = new URL(targetUrl);
  const rawSlug = parsedUrl.hostname
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const baseId = rawSlug.length >= 3 ? rawSlug.slice(0, 62) : "custom-web-base";

  const discoveredSlots: PortableSlotSpec[] = [];
  for (const candidate of LANDMARK_CANDIDATES) {
    const tagRegex = new RegExp(`<${candidate.tag}[\\s>]`, "i");
    if (tagRegex.test(html)) {
      discoveredSlots.push({
        id: candidate.slotId,
        cardinality: "singleton",
        description: candidate.description,
        routes: ["/*"],
        anchor_selector: candidate.tag,
        placement: "inside-start",
        context_props: [],
      });
    }
  }

  if (discoveredSlots.length === 0) {
    discoveredSlots.push({
      id: "body.dock",
      cardinality: "singleton",
      description: "Fallback floating slot mounted inside <body>.",
      routes: ["/*"],
      anchor_selector: "body",
      placement: "inside-end",
      context_props: [],
    });
  }

  const cssVars = new Set<string>();
  const varMatches = html.matchAll(/(--[a-z0-9-]{2,40})\s*:/gi);
  for (const match of varMatches) {
    if (match[1]) cssVars.add(match[1]);
  }

  const tokens: Record<string, string> = {};
  if (cssVars.has("--background")) tokens["--newt-bg"] = "--background";
  else if (cssVars.has("--bg-primary")) tokens["--newt-bg"] = "--bg-primary";

  if (cssVars.has("--card")) tokens["--newt-card"] = "--card";
  else if (cssVars.has("--bg-card")) tokens["--newt-card"] = "--bg-card";

  if (cssVars.has("--foreground")) tokens["--newt-fg"] = "--foreground";
  else if (cssVars.has("--text-main")) tokens["--newt-fg"] = "--text-main";

  if (cssVars.has("--primary")) tokens["--newt-primary"] = "--primary";
  if (cssVars.has("--accent")) tokens["--newt-accent"] = "--accent";
  if (cssVars.has("--border")) tokens["--newt-border"] = "--border";

  return {
    contract_version: "1.0.0",
    base: {
      id: baseId,
      name: parsedUrl.hostname,
      framework: html.includes("/_next/") ? "nextjs" : "generic-html",
      origin: parsedUrl.origin,
      description: `Auto-synthesized Base Profile from ${parsedUrl.origin}`,
    },
    runtime: {
      allow_levels: [1, 2],
      supports_client_only_hydration: true,
    },
    auth: {
      strategy: "anonymous-dev",
    },
    theme: {
      dark_mode_selector: "html.dark",
      tokens,
    },
    slots: discoveredSlots,
    permissions_catalog: {
      readable_collections: [],
      sensitive_collections: [],
    },
    canonical_entities: {},
  };
}
