"use client";

import { useEffect, useRef, useState } from "react";
import type { BrowserSalamandaHostBroker } from "../browser-broker";
import { safeSetArticleHtml } from "../html-sanitizer";
import type { BasePackDto, CompiledLimbBundle } from "../types";
import { LimbSlotFrame } from "./LimbSlotFrame";
import type { ResolvedTheme } from "./ThemeToggle";

interface BlogPostDoc {
  id: string;
  title: string;
  slug: string;
  subtitle?: string;
  content: string;
  plainTextPreview?: string;
  tags?: string[];
  authorId?: string;
  authorName?: string;
  readingTime?: number;
}

interface MicropostDoc {
  id: string;
  text: string;
  authorId?: string;
  authorName?: string;
  createdAt?: string;
}

function SanitizedTipTapArticle({ html }: { html: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (ref.current) {
      safeSetArticleHtml(ref.current, html);
    }
  }, [html]);

  return (
    <div
      ref={ref}
      style={{
        fontSize: "16px",
        lineHeight: 1.72,
        display: "grid",
        gap: "12px",
      }}
    />
  );
}

export function BaseShellSimulator(props: {
  base: BasePackDto;
  bundle: CompiledLimbBundle | null;
  broker: BrowserSalamandaHostBroker;
  theme: ResolvedTheme;
  activeRoute: string;
  onRouteChange: (route: string) => void;
}) {
  const { base, bundle, broker, theme, activeRoute, onRouteChange } = props;
  const [standaloneWidth, setStandaloneWidth] = useState<"card" | "mobile" | "full">("card");
  const [showAllSlots, setShowAllSlots] = useState(false);
  const [extraMicroposts, setExtraMicroposts] = useState<MicropostDoc[]>([]);
  const [manifestThemeVariant, setManifestThemeVariant] = useState<"paper" | "daylight" | "obsidian">(
    theme === "dark" ? "obsidian" : "paper"
  );

  const isStandalone = base.id === "standalone";
  const isXkmato = base.id === "xkmato";

  // 1. Standalone Isolated Component Canvas
  if (isStandalone) {
    const maxWidth =
      standaloneWidth === "mobile" ? "375px" : standaloneWidth === "card" ? "480px" : "100%";
    const slotId = base.manifest.slots[0]?.id ?? "standalone.canvas";

    return (
      <div style={{ padding: "20px", display: "grid", gap: "16px" }} data-testid="standalone-simulator">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "8px",
          }}
        >
          <span style={{ fontSize: "12.5px", color: "var(--studio-muted)" }}>
            Isolated Standalone UI Canvas · Theme: <strong>{theme}</strong>
          </span>
          <div style={{ display: "flex", gap: "6px" }}>
            {(["card", "mobile", "full"] as const).map((preset) => (
              <button
                key={preset}
                type="button"
                className={`studio-btn ${standaloneWidth === preset ? "primary" : ""}`}
                onClick={() => setStandaloneWidth(preset)}
              >
                {preset === "card" ? "Card 480px" : preset === "mobile" ? "Mobile 375px" : "Full Width"}
              </button>
            ))}
          </div>
        </div>

        <div
          style={{
            margin: "0 auto",
            width: "100%",
            maxWidth,
            padding: "24px",
            borderRadius: "14px",
            border: "1px solid var(--studio-border)",
            background: "var(--studio-panel)",
          }}
        >
          <LimbSlotFrame
            broker={broker}
            bundle={bundle}
            slotId={slotId}
            route="/"
            contextProps={{ viewport: standaloneWidth }}
            theme={theme}
            showSlotOutline={true}
          />
        </div>
      </div>
    );
  }

  // 2. Faithful XKmato Base Shell Simulator
  if (isXkmato) {
    const blogposts = (base.fixtures.blogposts ?? []) as unknown as BlogPostDoc[];
    const baseMicroposts = (base.fixtures.microposts ?? []) as unknown as MicropostDoc[];
    const microposts = [...baseMicroposts, ...extraMicroposts];
    const activePost = blogposts[0] ?? {
      id: "post-1",
      title: "Launching Amphibian",
      slug: "launching-amphibian",
      subtitle: "Build for your own consumption taste.",
      content: "<p>Sample XKmato essay body.</p>",
      authorId: "uid:kenneth",
      authorName: "Kenneth",
      readingTime: 4,
      tags: ["amphibian"],
    };

    const routes = [
      { path: "/", label: "Home (/)" },
      { path: "/blog", label: "Blog (/blog)" },
      { path: `/blog/${activePost.slug}`, label: `Essay (/blog/${activePost.slug})` },
      { path: "/feed", label: "Feed (/feed)" },
    ];

    const loadMoreMicroposts = () => {
      const nextNum = microposts.length + 1;
      setExtraMicroposts((prev) => [
        ...prev,
        {
          id: `sim_micro_${nextNum}`,
          text: `Dynamically appended micropost #${nextNum} — proving infinite-scroll repeater slot hydration.`,
          authorId: "uid:kenneth",
          authorName: "Kenneth",
          createdAt: new Date().toISOString(),
        },
      ]);
    };

    return (
      <div style={{ padding: "16px", display: "grid", gap: "12px" }} data-testid="xkmato-simulator">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "8px",
          }}
        >
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {routes.map((r) => (
              <button
                key={r.path}
                type="button"
                className={`studio-btn ${activeRoute === r.path ? "primary" : ""}`}
                data-testid={`sim-route-${r.path}`}
                onClick={() => onRouteChange(r.path)}
              >
                {r.label}
              </button>
            ))}
          </div>
          <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12px" }}>
            <input
              type="checkbox"
              checked={showAllSlots}
              onChange={(e) => setShowAllSlots(e.target.checked)}
            />
            Show empty slot anchors
          </label>
        </div>

        <div className="xkmato-shell">
          <header
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "12px 20px",
              borderBottom: "1px solid var(--studio-border)",
              background: "var(--studio-surface)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <strong style={{ fontSize: "15px" }}>XKmato</strong>
              <span style={{ fontSize: "12px", color: "var(--studio-muted)" }}>
                Simulated Host · <code>{activeRoute}</code>
              </span>
            </div>
            <span className="studio-badge">Base Pack: xkmato</span>
          </header>

          {activeRoute.startsWith("/blog/") ? (
            <div className="xkmato-article-grid" data-testid="xkmato-article-grid">
              <article style={{ display: "grid", gap: "14px" }}>
                <div>
                  <div style={{ display: "flex", gap: "6px", marginBottom: "8px", flexWrap: "wrap" }}>
                    {(activePost.tags ?? []).map((tag) => (
                      <span key={tag} className="studio-badge">
                        #{tag}
                      </span>
                    ))}
                  </div>
                  <h1 style={{ margin: "0 0 6px", fontSize: "26px", lineHeight: 1.2 }}>
                    {activePost.title}
                  </h1>
                  {activePost.subtitle ? (
                    <p style={{ margin: "0 0 8px", color: "var(--studio-muted)", fontSize: "15px" }}>
                      {activePost.subtitle}
                    </p>
                  ) : null}
                  <div style={{ fontSize: "12px", color: "var(--studio-muted)" }}>
                    By {activePost.authorName ?? "Kenneth"} · {activePost.readingTime ?? 4} min read
                  </div>
                </div>

                <LimbSlotFrame
                  broker={broker}
                  bundle={bundle}
                  slotId="blog.header"
                  route={activeRoute}
                  contextProps={{
                    "post-id": activePost.id,
                    "post-slug": activePost.slug,
                    "author-id": activePost.authorId ?? "uid:kenneth",
                    "reading-time": String(activePost.readingTime ?? 4),
                  }}
                  theme={theme}
                  showSlotOutline={showAllSlots}
                />

                <SanitizedTipTapArticle html={activePost.content} />

                <LimbSlotFrame
                  broker={broker}
                  bundle={bundle}
                  slotId="blog.footer"
                  route={activeRoute}
                  contextProps={{
                    "post-id": activePost.id,
                    "post-slug": activePost.slug,
                  }}
                  theme={theme}
                  showSlotOutline={showAllSlots}
                />
              </article>

              <aside className="xkmato-sidebar-rail" aria-label="Blog Companion Sidebar">
                <div style={{ position: "sticky", top: "16px" }}>
                  <LimbSlotFrame
                    broker={broker}
                    bundle={bundle}
                    slotId="blog.sidebar"
                    route={activeRoute}
                    contextProps={{
                      "post-id": activePost.id,
                      "post-slug": activePost.slug,
                      "author-id": activePost.authorId ?? "uid:kenneth",
                    }}
                    theme={theme}
                    showSlotOutline={showAllSlots}
                  />
                </div>
              </aside>
            </div>
          ) : activeRoute === "/blog" ? (
            <div style={{ padding: "24px", maxWidth: "760px", margin: "0 auto", display: "grid", gap: "16px" }}>
              <h1 style={{ margin: 0, fontSize: "22px" }}>Essays</h1>
              <LimbSlotFrame
                broker={broker}
                bundle={bundle}
                slotId="blog.list.header"
                route="/blog"
                theme={theme}
                showSlotOutline={showAllSlots}
              />
              {blogposts.map((post) => (
                <div
                  key={post.id}
                  style={{
                    padding: "16px",
                    border: "1px solid var(--studio-border)",
                    borderRadius: "10px",
                    display: "grid",
                    gap: "6px",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => onRouteChange(`/blog/${post.slug}`)}
                    style={{
                      textAlign: "left",
                      background: "none",
                      border: "none",
                      padding: 0,
                      color: "var(--studio-fg)",
                      fontSize: "17px",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    {post.title}
                  </button>
                  <p style={{ margin: 0, fontSize: "13.5px", color: "var(--studio-muted)" }}>
                    {post.subtitle}
                  </p>
                </div>
              ))}
            </div>
          ) : activeRoute === "/feed" ? (
            <div style={{ padding: "24px", maxWidth: "660px", margin: "0 auto", display: "grid", gap: "14px" }}>
              <h1 style={{ margin: 0, fontSize: "22px" }}>Microblog Feed</h1>
              <LimbSlotFrame
                broker={broker}
                bundle={bundle}
                slotId="feed.header"
                route="/feed"
                theme={theme}
                showSlotOutline={showAllSlots}
              />
              {microposts.map((post) => (
                <article
                  key={post.id}
                  style={{
                    padding: "14px 16px",
                    borderRadius: "10px",
                    border: "1px solid var(--studio-border)",
                    background: "var(--studio-bg)",
                    display: "grid",
                    gap: "10px",
                  }}
                >
                  <div style={{ fontSize: "12px", color: "var(--studio-muted)" }}>
                    <strong>{post.authorName ?? "Kenneth"}</strong> · <code>{post.id}</code>
                  </div>
                  <p style={{ margin: 0, fontSize: "14.5px", lineHeight: 1.55 }}>{post.text}</p>
                  <LimbSlotFrame
                    broker={broker}
                    bundle={bundle}
                    slotId="micropost.footer"
                    route="/feed"
                    instanceKey={post.id}
                    contextProps={{
                      "post-id": post.id,
                      "author-id": post.authorId ?? "uid:kenneth",
                    }}
                    theme={theme}
                    showSlotOutline={showAllSlots}
                  />
                </article>
              ))}
              <button type="button" className="studio-btn" onClick={loadMoreMicroposts}>
                Load more microposts (test repeater slot)
              </button>
              <LimbSlotFrame
                broker={broker}
                bundle={bundle}
                slotId="feed.footer"
                route="/feed"
                theme={theme}
                showSlotOutline={showAllSlots}
              />
            </div>
          ) : (
            <div style={{ padding: "24px", maxWidth: "720px", margin: "0 auto", display: "grid", gap: "16px" }}>
              <section style={{ padding: "18px 0" }}>
                <h1 style={{ margin: "0 0 6px", fontSize: "24px" }}>XKmato — Living Personal Publishing</h1>
                <p style={{ margin: 0, color: "var(--studio-muted)", fontSize: "14.5px" }}>
                  Essays, microposts, and reader-built Amphibian limbs running cleanly on top.
                </p>
              </section>

              <LimbSlotFrame
                broker={broker}
                bundle={bundle}
                slotId="home.hero.after"
                route="/"
                theme={theme}
                showSlotOutline={showAllSlots}
              />

              <div style={{ display: "grid", gap: "10px" }}>
                <h2 style={{ margin: 0, fontSize: "15px" }}>Latest Microposts</h2>
                {microposts.slice(0, 2).map((post) => (
                  <article
                    key={post.id}
                    style={{
                      padding: "12px 14px",
                      borderRadius: "10px",
                      border: "1px solid var(--studio-border)",
                      display: "grid",
                      gap: "8px",
                    }}
                  >
                    <p style={{ margin: 0, fontSize: "14px" }}>{post.text}</p>
                    <LimbSlotFrame
                      broker={broker}
                      bundle={bundle}
                      slotId="micropost.footer"
                      route="/"
                      instanceKey={post.id}
                      contextProps={{
                        "post-id": post.id,
                        "author-id": post.authorId ?? "uid:kenneth",
                      }}
                      theme={theme}
                      showSlotOutline={showAllSlots}
                    />
                  </article>
                ))}
              </div>
            </div>
          )}

          <div style={{ padding: "0 20px 14px" }}>
            <LimbSlotFrame
              broker={broker}
              bundle={bundle}
              slotId="shell.dock"
              route={activeRoute}
              theme={theme}
              showSlotOutline={showAllSlots}
            />
          </div>
        </div>
      </div>
    );
  }

  // 3. Generic Manifest-Driven Base Shell for `blog` and ANY Custom AmphibianPlatformManifest
  const supportsMultiTheme =
    (base.manifest.theme.dark_mode_selector ?? "").includes("obsidian") ||
    (base.manifest.theme.dark_mode_selector ?? "").includes("data-theme");
  const effectiveSimTheme: ResolvedTheme = supportsMultiTheme
    ? manifestThemeVariant === "obsidian"
      ? "dark"
      : "light"
    : theme;

  const samplePost = (base.fixtures.posts?.[0] ?? null) as Record<string, unknown> | null;
  const sampleFeed = (base.fixtures.feed ?? []) as Array<Record<string, unknown>>;
  const sampleBook = (base.fixtures.books?.[0] ?? null) as Record<string, unknown> | null;
  const sampleNewsletter = (base.fixtures.newsletters?.[0] ?? null) as Record<string, unknown> | null;

  const resolveSampleRoute = (pattern: string): string => {
    if (pattern === "/*") return "/";
    if (pattern === "/[slug]") return `/${String(samplePost?.slug ?? "living-personal-software")}`;
    if (pattern === "/feed/[id]") return `/feed/${String(sampleFeed[0]?.id ?? "feed-1")}`;
    if (pattern === "/books/[slug]") return `/books/${String(sampleBook?.slug ?? "malleable-web")}`;
    if (pattern === "/newsletter/[slug]") {
      return `/newsletter/${String(sampleNewsletter?.slug ?? "issue-12-amphibian")}`;
    }
    return pattern.replace(/\*$/, "sample");
  };

  const routeEntries = Array.from(
    new Map(
      base.manifest.slots
        .flatMap((slot) => slot.routes)
        .filter((r) => r !== "/*")
        .map((pattern) => {
          const resolved = resolveSampleRoute(pattern);
          return [resolved, { pattern, path: resolved }] as const;
        })
    ).values()
  );
  if (routeEntries.length === 0) {
    routeEntries.push({ pattern: "/", path: "/" });
  }

  const normalizedRoute = routeEntries.some((r) => r.path === activeRoute)
    ? activeRoute
    : routeEntries[0]!.path;

  const routeMatchesPattern = (route: string, pattern: string): boolean => {
    if (pattern === "/*" || pattern === route) return true;
    if (pattern.endsWith("/*")) {
      return route.startsWith(pattern.slice(0, -1));
    }
    if (pattern.includes("[")) {
      const regexStr =
        "^" +
        pattern
          .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
          .replace(/\\\[[^\]]+\\\]/g, "[^/]+") +
        "$";
      return new RegExp(regexStr).test(route);
    }
    return false;
  };

  const matchingSlots = base.manifest.slots.filter((slot) =>
    slot.routes.some((pat) => routeMatchesPattern(normalizedRoute, pat))
  );

  const buildContextForSlot = (
    slot: BasePackDto["manifest"]["slots"][number],
    item?: Record<string, unknown>,
    idx = 0
  ): Record<string, string> => {
    const ctx: Record<string, string> = {};
    for (const prop of slot.context_props ?? []) {
      if (prop === "post-id") ctx[prop] = String(item?.id ?? samplePost?.id ?? `item-${idx + 1}`);
      else if (prop === "item-id") ctx[prop] = String(item?.id ?? `item-${idx + 1}`);
      else if (prop === "slug" || prop === "post-slug") {
        ctx[prop] = String(item?.slug ?? samplePost?.slug ?? "living-personal-software");
      } else if (prop === "reading-time") {
        ctx[prop] = String(item?.readingTime ?? samplePost?.readingTime ?? 5);
      } else if (prop === "audience") {
        ctx[prop] = String(item?.audience ?? samplePost?.audience ?? "everyone");
      } else if (prop === "book-slug") {
        ctx[prop] = String(sampleBook?.slug ?? "malleable-web");
      } else if (prop === "chapter-id") {
        ctx[prop] = "ch-1";
      } else if (prop === "kind") {
        ctx[prop] = item?.slug ? "post" : "feed";
      } else {
        ctx[prop] = `${prop}-${idx + 1}`;
      }
    }
    return ctx;
  };

  const repeaterItems: Array<Record<string, unknown>> =
    sampleFeed.length > 0
      ? sampleFeed
      : (base.fixtures.posts?.length ?? 0) > 0
        ? (base.fixtures.posts as Array<Record<string, unknown>>)
        : [{ id: "item-1", text: "Sample Item #1" }, { id: "item-2", text: "Sample Item #2" }];

  return (
    <div style={{ padding: "16px", display: "grid", gap: "12px" }} data-testid="custom-base-simulator">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "8px",
        }}
      >
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          {routeEntries.map((r) => (
            <button
              key={r.path}
              type="button"
              className={`studio-btn ${normalizedRoute === r.path ? "primary" : ""}`}
              data-testid={`sim-route-${r.path}`}
              onClick={() => onRouteChange(r.path)}
            >
              {r.pattern}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          {supportsMultiTheme ? (
            <div style={{ display: "inline-flex", gap: "4px" }} role="group" aria-label="Host theme">
              {(["paper", "daylight", "obsidian"] as const).map((variant) => (
                <button
                  key={variant}
                  type="button"
                  className={`studio-btn ${manifestThemeVariant === variant ? "primary" : ""}`}
                  style={{ padding: "3px 8px", fontSize: "11.5px" }}
                  onClick={() => setManifestThemeVariant(variant)}
                >
                  {variant}
                </button>
              ))}
            </div>
          ) : null}
          <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12px" }}>
            <input
              type="checkbox"
              checked={showAllSlots}
              onChange={(e) => setShowAllSlots(e.target.checked)}
            />
            Show empty slots
          </label>
        </div>
      </div>

      <div
        className="xkmato-shell"
        data-theme={supportsMultiTheme ? manifestThemeVariant : effectiveSimTheme}
        style={{ padding: "20px", display: "grid", gap: "16px" }}
      >
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderBottom: "1px solid var(--studio-border)",
            paddingBottom: "12px",
          }}
        >
          <div>
            <h1 style={{ margin: 0, fontSize: "18px" }}>{base.manifest.base.name}</h1>
            <p style={{ margin: "4px 0 0", fontSize: "12.5px", color: "var(--studio-muted)" }}>
              Route: <code>{normalizedRoute}</code> · Framework: {base.manifest.base.framework} · Origin:{" "}
              {base.manifest.base.origin ?? "local"}
            </p>
          </div>
          <span className="studio-badge">Base: {base.id}</span>
        </header>

        {matchingSlots.map((slot) => (
          <section
            key={slot.id}
            style={{
              padding: "12px",
              borderRadius: "10px",
              border: "1px solid var(--studio-border)",
              display: "grid",
              gap: "8px",
            }}
          >
            <div style={{ fontSize: "12px", color: "var(--studio-muted)" }}>
              <strong>{slot.id}</strong> ({slot.cardinality}) — {slot.description}
            </div>
            {slot.cardinality === "repeater" ? (
              <div style={{ display: "grid", gap: "8px" }}>
                {repeaterItems.map((item, idx) => {
                  const itemId = String(item.id ?? `item-${idx + 1}`);
                  return (
                    <div
                      key={itemId}
                      style={{
                        padding: "10px",
                        borderRadius: "8px",
                        border: "1px solid var(--studio-border)",
                        display: "grid",
                        gap: "6px",
                      }}
                    >
                      {item.text || item.title ? (
                        <div style={{ fontSize: "13px" }}>
                          {String(item.title ?? item.text)}
                        </div>
                      ) : null}
                      <LimbSlotFrame
                        broker={broker}
                        bundle={bundle}
                        slotId={slot.id}
                        route={normalizedRoute}
                        instanceKey={itemId}
                        contextProps={buildContextForSlot(slot, item, idx)}
                        theme={effectiveSimTheme}
                        showSlotOutline={showAllSlots || true}
                      />
                    </div>
                  );
                })}
              </div>
            ) : (
              <LimbSlotFrame
                broker={broker}
                bundle={bundle}
                slotId={slot.id}
                route={normalizedRoute}
                contextProps={buildContextForSlot(slot)}
                theme={effectiveSimTheme}
                showSlotOutline={showAllSlots || true}
              />
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
