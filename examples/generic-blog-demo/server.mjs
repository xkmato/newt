import http from "node:http";

/**
 * Minimal ~90-line Vanilla Node + HTML blog platform proving cross-platform portability
 * of `@newt/bridge` + Newt Studio without Next.js, React, or Firebase.
 */
export function createGenericBlogServer(options = {}) {
  const newtOrigin = (options.newtOrigin ?? process.env.NEWT_URL ?? "http://127.0.0.1:3100").replace(
    /\/+$/,
    ""
  );
  const authToken = options.authToken ?? "oidc-demo-token-generic-blog";

  const manifest = {
    $schema: "https://amphibian.dev/schemas/v1/platform-manifest.schema.json",
    contract_version: "1.0.0",
    base: {
      id: "generic-blog",
      name: "Generic Indie Blog",
      framework: "vanilla-html",
      origin: options.origin ?? "http://127.0.0.1:4300",
      description: "Zero-framework HTML blog proving Amphibian cross-platform portability.",
    },
    runtime: { allow_levels: [1, 2], supports_client_only_hydration: true },
    auth: { strategy: "oidc-bearer" },
    theme: {
      dark_mode_selector: "html.dark",
      tokens: {
        "--newt-bg": "--blog-bg",
        "--newt-card": "--blog-card",
        "--newt-fg": "--blog-fg",
        "--newt-primary": "--blog-accent",
        "--newt-border": "--blog-border",
      },
    },
    slots: [
      {
        id: "article.sidebar",
        cardinality: "singleton",
        description: "Companion sidebar rail next to the vanilla HTML article.",
        routes: ["/articles/*", "/"],
        anchor_selector: '[data-salamanda-slot="article.sidebar"]',
        placement: "inside-end",
        context_props: ["post-id", "post-slug"],
      },
      {
        id: "comment.actions",
        cardinality: "repeater",
        description: "Compact repeater toolbar rendered inside each reader comment.",
        routes: ["/articles/*", "/"],
        anchor_selector: '[data-salamanda-slot="comment.actions"]',
        placement: "inside-end",
        context_props: ["item-id"],
      },
    ],
    permissions_catalog: {
      readable_collections: ["articles"],
      sensitive_collections: ["admin_audit"],
    },
    canonical_entities: {
      articles: {
        description: "Plain HTML blog articles",
        fields: { id: "string", title: "string", body: "html_string" },
      },
    },
  };

  const renderPage = () => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Generic Indie Blog — Amphibian Portability Demo</title>
  <style>
    :root { --blog-bg:#fafafa; --blog-card:#ffffff; --blog-fg:#18181b; --blog-accent:#2563eb; --blog-border:#e4e4e7; }
    body { margin:0; font-family:system-ui,sans-serif; background:var(--blog-bg); color:var(--blog-fg); }
    header { display:flex; justify-content:space-between; align-items:center; padding:14px 24px; border-bottom:1px solid var(--blog-border); background:var(--blog-card); }
    main { max-width:1040px; margin:24px auto; padding:0 20px; display:grid; grid-template-columns:minmax(0,1fr) 320px; gap:24px; }
    article, .comment { background:var(--blog-card); border:1px solid var(--blog-border); border-radius:10px; padding:16px; }
    .comments { display:grid; gap:12px; margin-top:16px; }
    #customize-btn { display:none; padding:6px 12px; border-radius:8px; border:1px solid var(--blog-border); background:var(--blog-accent); color:#fff; font-weight:600; cursor:pointer; }
  </style>
</head>
<body>
  <header>
    <strong>Generic Indie Blog (Vanilla HTML + OIDC Bearer)</strong>
    <button id="customize-btn" type="button" data-testid="open-newt-drawer">✦ Customize Blog</button>
  </header>
  <main>
    <div>
      <article>
        <h1>Portable Living Software Beyond One Stack</h1>
        <p>This zero-Next.js, zero-Firebase HTML site mounts the exact same <code>@newt/bridge</code> script.</p>
      </article>
      <section class="comments" aria-label="Comments">
        <div class="comment" data-testid="comment-1">
          <p>First reader comment on portability.</p>
          <amphibian-slot data-salamanda-slot="comment.actions" data-item-id="cmt-1"></amphibian-slot>
        </div>
        <div class="comment" data-testid="comment-2">
          <p>Second reader comment proving repeater slots.</p>
          <amphibian-slot data-salamanda-slot="comment.actions" data-item-id="cmt-2"></amphibian-slot>
        </div>
      </section>
    </div>
    <aside aria-label="Article Sidebar">
      <amphibian-slot data-salamanda-slot="article.sidebar" data-post-id="portable-1" data-post-slug="portable-living-software"></amphibian-slot>
    </aside>
  </main>
  <script>
    window.NewtHost = {
      baseId: "generic-blog",
      manifestUrl: "/.well-known/amphibian.json",
      getAuthToken: function() { return Promise.resolve(${JSON.stringify(authToken)}); }
    };
    window.addEventListener("newt:ready", function() {
      var btn = document.getElementById("customize-btn");
      if (btn) {
        btn.style.display = "inline-block";
        btn.onclick = function() { window.NewtHost.openDrawer && window.NewtHost.openDrawer(); };
      }
    });
  </script>
  <script id="newt-bridge-script" src="${newtOrigin}/bridge.js" data-base="generic-blog" data-newt-origin="${newtOrigin}" async defer onerror="void 0"></script>
</body>
</html>`;

  return http.createServer((req, res) => {
    if (req.url === "/.well-known/amphibian.json") {
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(JSON.stringify(manifest, null, 2));
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderPage());
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 4300);
  const server = createGenericBlogServer({ origin: `http://127.0.0.1:${port}` });
  server.listen(port, "127.0.0.1", () => {
    console.log(`Generic Indie Blog demo listening on http://127.0.0.1:${port}`);
  });
}
