import type { AmphibianPlatformManifest, BasePack } from "@newt/base-sdk";
import type { BaseSpec } from "@newt/contract";

export const blogPlatformManifest: AmphibianPlatformManifest = {
  $schema: "https://amphibian.dev/schemas/v1/platform-manifest.schema.json",
  contract_version: "1.0.0",
  base: {
    id: "blog",
    name: "XKmato Blog",
    framework: "nextjs",
    origin: "http://127.0.0.1:3000",
    description:
      "XKmato personal publishing platform with long-form articles, microblog feed, books, and newsletters.",
  },
  runtime: {
    allow_levels: [1, 2],
    supports_client_only_hydration: true,
    health_path: "/api/health",
  },
  auth: {
    strategy: "host-token-callback",
    ssr_cookie: "__session",
    login_path: "/login",
  },
  theme: {
    dark_mode_selector: '[data-theme="obsidian"]',
    tokens: {
      "--newt-bg": "--bg-primary",
      "--newt-surface": "--bg-surface",
      "--newt-card": "--bg-card",
      "--newt-fg": "--text-main",
      "--newt-muted": "--text-muted",
      "--newt-primary": "--accent",
      "--newt-primary-fg": "--bg-primary",
      "--newt-accent": "--accent",
      "--newt-accent-fg": "--bg-primary",
      "--newt-border": "--border",
      "--newt-ring": "--accent",
      "--newt-radius": "--radius",
    },
    light_fallbacks: {
      "--bg-primary": "#f9f7f2",
      "--bg-surface": "#f1ede4",
      "--bg-card": "#ffffff",
      "--text-main": "#1f1d1a",
      "--text-muted": "#6b655c",
      "--accent": "#b45309",
      "--border": "#e5dfd3",
      "--radius": "0.625rem",
    },
    dark_fallbacks: {
      "--bg-primary": "#0e0f12",
      "--bg-surface": "#16181d",
      "--bg-card": "#1c1f26",
      "--text-main": "#f3f4f6",
      "--text-muted": "#9ca3af",
      "--accent": "#f59e0b",
      "--border": "rgba(255, 255, 255, 0.12)",
      "--radius": "0.625rem",
    },
  },
  slots: [
    {
      id: "article.header",
      cardinality: "singleton",
      description:
        "Mounted above the article body on /[slug] with post-id, slug, reading-time, and audience context.",
      routes: ["/[slug]"],
      anchor_selector: '[data-salamanda-slot="article.header"]',
      placement: "inside-end",
      context_props: ["post-id", "slug", "reading-time", "audience"],
    },
    {
      id: "article.footer",
      cardinality: "singleton",
      description:
        "Mounted below EngagementBar and above CommentThread on /[slug].",
      routes: ["/[slug]"],
      anchor_selector: '[data-salamanda-slot="article.footer"]',
      placement: "inside-end",
      context_props: ["post-id", "slug", "audience"],
    },
    {
      id: "article.sidebar",
      cardinality: "singleton",
      description:
        "Progressive desktop companion rail beside the article body on /[slug], visible only when mounted.",
      routes: ["/[slug]"],
      anchor_selector: '[data-salamanda-slot="article.sidebar"]',
      placement: "inside-end",
      context_props: ["post-id", "slug", "audience"],
    },
    {
      id: "home.top",
      cardinality: "singleton",
      description: "Mounted at the top of HomeTimeline on /.",
      routes: ["/"],
      anchor_selector: '[data-salamanda-slot="home.top"]',
      placement: "inside-end",
      context_props: [],
    },
    {
      id: "timeline.item.footer",
      cardinality: "repeater",
      description:
        "Repeater slot mounted inside each card in HomeTimeline on / (articles and feed items).",
      routes: ["/"],
      anchor_selector: '[data-salamanda-slot="timeline.item.footer"]',
      placement: "inside-end",
      context_props: ["post-id", "item-id", "kind"],
    },
    {
      id: "feed.item.footer",
      cardinality: "repeater",
      description: "Repeater slot mounted inside each FeedCard on /feed and /feed/[id].",
      routes: ["/feed", "/feed/[id]"],
      anchor_selector: '[data-salamanda-slot="feed.item.footer"]',
      placement: "inside-end",
      context_props: ["post-id", "item-id"],
    },
    {
      id: "archive.header",
      cardinality: "singleton",
      description: "Mounted above the archive listing on /archive and /articles.",
      routes: ["/archive", "/articles"],
      anchor_selector: '[data-salamanda-slot="archive.header"]',
      placement: "inside-end",
      context_props: [],
    },
    {
      id: "book.chapter.header",
      cardinality: "singleton",
      description: "Mounted above book chapter content on /books/[slug].",
      routes: ["/books/[slug]"],
      anchor_selector: '[data-salamanda-slot="book.chapter.header"]',
      placement: "inside-end",
      context_props: ["book-slug", "chapter-id"],
    },
    {
      id: "shell.dock",
      cardinality: "singleton",
      description: "Global floating dock in the root layout across all routes including /newsletter/[slug].",
      routes: ["/*", "/newsletter/[slug]"],
      anchor_selector: '[data-salamanda-slot="shell.dock"]',
      placement: "inside-end",
      context_props: [],
    },
  ],
  permissions_catalog: {
    readable_collections: ["posts", "feed", "books", "newsletters", "users:public"],
    sensitive_collections: [
      "subscribers",
      "comments",
      "feed_comments",
      "author_messages",
      "customers",
      "speculation_bets",
      "notifications",
    ],
  },
  canonical_entities: {
    posts: {
      description:
        "Published long-form articles (paywall-aware: paid/founding bodies are truncated for unentitled readers).",
      fields: {
        id: "string",
        slug: "string",
        title: "string",
        subtitle: "string",
        excerpt: "string",
        content: "html_string",
        audience: "everyone | paid | founding",
        readingTime: "number",
        tags: "string[]",
        publishedAt: "iso_timestamp",
      },
    },
    feed: {
      description: "Non-deleted short-form microblog feed notes.",
      fields: {
        id: "string",
        text: "string",
        authorHandle: "string",
        mediaUrls: "string[]",
        createdAt: "iso_timestamp",
      },
    },
    books: {
      description: "Serialized book collections and chapters.",
      fields: {
        id: "string",
        slug: "string",
        title: "string",
        description: "string",
        chapters: "Array<{ id: string, title: string, order: number }>",
      },
    },
    newsletters: {
      description: "Published newsletter editions.",
      fields: {
        id: "string",
        slug: "string",
        title: "string",
        summary: "string",
        publishedAt: "iso_timestamp",
      },
    },
    "users:public": {
      description: "Public profile fields only (handle, displayName, bio, avatarUrl). Never includes email or private subscriber data.",
      fields: {
        uid: "string",
        handle: "string",
        displayName: "string",
        bio: "string",
        avatarUrl: "string",
      },
    },
  },
};

export const blogBaseSpec: BaseSpec = {
  base: {
    name: "blog",
    upstream: "http://127.0.0.1:3000",
    framework: "nextjs",
  },
  extensions: {
    allow_levels: [1, 2],
    slots_manifest: "slots.json",
  },
  identity: {
    adapter: "jwt",
    jwks_url: "https://www.googleapis.com/identitytoolkit/v3/relyingparty/publicKeys",
    issuer: "https://session.firebase.google.com/demo-xkmato",
    audience: "demo-xkmato",
    token_sources: ["cookie:__session", "header:authorization"],
  },
  data: {
    canonical: {
      mode: "base-api",
      adapter: "base-api",
      readable_collections: ["posts", "feed", "books", "newsletters", "users:public"],
      sensitive_collections: [
        "subscribers",
        "comments",
        "feed_comments",
        "author_messages",
        "customers",
        "speculation_bets",
        "notifications",
      ],
    },
  },
};

export const blogFixtures: Record<string, Array<Record<string, unknown>>> = {
  posts: [
    {
      id: "post-amphibian-notes",
      slug: "living-personal-software",
      title: "Living Personal Software on the Open Web",
      subtitle: "How Salamanda and Newt turn static publishing into malleable personal tools.",
      excerpt: "Every reader brings a different workflow to an essay.",
      content:
        "<p>Personal publishing does not have to be read-only glass. With named slots and scoped SQLite sidecars, each reader can tailor the page without touching the author's canonical store.</p><p>Try switching between Paper, Daylight, and Obsidian themes to verify semantic token inheritance.</p>",
      audience: "everyone",
      readingTime: 5,
      tags: ["amphibian", "architecture"],
      publishedAt: "2026-11-20T09:00:00.000Z",
    },
    {
      id: "post-paid-deep-dive",
      slug: "paid-deep-dive-sidecars",
      title: "Deep Dive: Per-User SQLite Sidecars",
      subtitle: "Paywalled subscriber essay demonstrating truncated previews for free readers.",
      excerpt: "Public preview paragraph before the subscriber paywall boundary.",
      content: "<p>Public preview paragraph before the subscriber paywall boundary.</p>",
      audience: "paid",
      readingTime: 9,
      tags: ["sqlite", "security"],
      publishedAt: "2026-11-22T12:00:00.000Z",
    },
  ],
  feed: [
    {
      id: "feed-1",
      text: "Testing Amphibian repeater slots on the live home timeline and feed cards.",
      authorHandle: "kenneth",
      mediaUrls: [],
      createdAt: "2026-11-25T08:30:00.000Z",
    },
    {
      id: "feed-2",
      text: "Obsidian, Paper, and Daylight themes all map cleanly onto --newt-* semantic variables.",
      authorHandle: "kenneth",
      mediaUrls: [],
      createdAt: "2026-11-25T11:15:00.000Z",
    },
  ],
  books: [
    {
      id: "book-malleable-web",
      slug: "malleable-web",
      title: "Field Notes on the Malleable Web",
      description: "Serialized handbook on personal software extensions.",
      chapters: [
        { id: "ch-1", title: "Chapter 1: Slots & Isolation", order: 1 },
        { id: "ch-2", title: "Chapter 2: Sidecar State", order: 2 },
      ],
    },
  ],
  newsletters: [
    {
      id: "nl-issue-12",
      slug: "issue-12-amphibian",
      title: "Issue #12 — Amphibian Local Stack",
      summary: "End-to-end notes on pairing Salamanda with Next.js 16.",
      publishedAt: "2026-11-24T10:00:00.000Z",
    },
  ],
  "users:public": [
    {
      uid: "seed-admin",
      handle: "kenneth",
      displayName: "Kenneth",
      bio: "Building malleable publishing tools.",
      avatarUrl: "",
    },
  ],
};

export const blogBasePack: BasePack<Record<string, Array<Record<string, unknown>>>> = {
  manifest: blogPlatformManifest,
  baseSpec: blogBaseSpec,
  fixtures: blogFixtures,
};
