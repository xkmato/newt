import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  type AmphibianPlatformManifest,
  type BasePack,
  synthesizeManifestFromHtml,
  toSalamandaSlotsManifest,
  validatePlatformManifest,
} from "@newt/base-sdk";
import { xkmatoBasePack } from "@newt/base-xkmato";
import { type CompiledLimbBundle, compileLimbVfs, type NewtVfs } from "@newt/compiler";
import {
  type BaseSpec,
  SalamandaControlPlaneClient,
  serializeLimbManifestToml,
} from "@newt/contract";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface CliIo {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

const DEFAULT_IO: CliIo = {
  stdout: (line) => process.stdout.write(`${line}\n`),
  stderr: (line) => process.stderr.write(`${line}\n`),
};

function createStandaloneBasePack(): BasePack<Record<string, Array<Record<string, unknown>>>> {
  const manifest: AmphibianPlatformManifest = {
    contract_version: "1.0.0",
    base: {
      id: "standalone",
      name: "Standalone UI Canvas",
      framework: "preact-standalone",
      origin: "http://127.0.0.1:4173",
    },
    runtime: { allow_levels: [1, 2], supports_client_only_hydration: true },
    auth: { strategy: "anonymous-dev" },
    theme: {
      dark_mode_selector: "html.dark",
      tokens: {
        "--newt-bg": "--bg",
        "--newt-card": "--card",
        "--newt-fg": "--fg",
        "--newt-border": "--border",
      },
    },
    slots: [
      {
        id: "standalone.canvas",
        cardinality: "singleton",
        description: "Standalone UI Canvas slot",
        routes: ["/*"],
        anchor_selector: '[data-salamanda-slot="standalone.canvas"]',
        context_props: [],
      },
    ],
    permissions_catalog: { readable_collections: [], sensitive_collections: [] },
    canonical_entities: {},
  };

  return {
    manifest,
    baseSpec: baseSpecFromManifest(manifest),
    fixtures: {},
  };
}

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

export function resolveBasePackArg(
  baseArg?: string,
  projectDir?: string
): BasePack<Record<string, Array<Record<string, unknown>>>> {
  if (!baseArg || baseArg === "xkmato") {
    return xkmatoBasePack as unknown as BasePack<Record<string, Array<Record<string, unknown>>>>;
  }
  if (baseArg === "standalone") {
    return createStandaloneBasePack();
  }

  const candidate = path.resolve(projectDir ?? process.cwd(), baseArg);
  if (!fs.existsSync(candidate)) {
    throw new Error(`Base manifest file not found: ${candidate}`);
  }
  const manifest = JSON.parse(fs.readFileSync(candidate, "utf8")) as AmphibianPlatformManifest;
  const check = validatePlatformManifest(manifest);
  if (!check.valid) {
    throw new Error(`Invalid platform manifest '${candidate}': ${check.errors.join("; ")}`);
  }
  return {
    manifest,
    baseSpec: baseSpecFromManifest(manifest),
    fixtures: {},
  };
}

export function loadDirectoryToVfs(rootDir: string): NewtVfs {
  const vfs: NewtVfs = {};
  const absRoot = path.resolve(rootDir);
  const IGNORE = new Set(["node_modules", "dist", "dist-limb", ".git", ".next"]);

  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (IGNORE.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        const rel = path.relative(absRoot, full).split(path.sep).join("/");
        if (
          rel === "limb.toml" ||
          rel.startsWith("src/") ||
          rel.startsWith("ui/") ||
          rel.startsWith("migrations/") ||
          rel.startsWith("functions/") ||
          rel.startsWith("fixtures/")
        ) {
          vfs[rel] = fs.readFileSync(full, "utf8");
        }
      }
    }
  };

  walk(absRoot);
  return vfs;
}

export interface InitOptions {
  dir: string;
  base?: string;
  name?: string;
  slot?: string;
  level?: 1 | 2;
}

export function runInitCommand(options: InitOptions, io: CliIo = DEFAULT_IO): {
  dir: string;
  limbId: string;
  files: string[];
} {
  const targetDir = path.resolve(options.dir);
  const basePack = resolveBasePackArg(options.base ?? "xkmato");
  const level = options.level ?? 1;
  const displayName = options.name ?? path.basename(targetDir);
  const limbId =
    displayName
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 56) || "my-newt-limb";
  const slotId =
    options.slot ??
    (basePack.manifest.slots.find((s) => s.id === "blog.sidebar")?.id ??
      basePack.manifest.slots[0]?.id ??
      "standalone.canvas");
  const slotSpec = basePack.manifest.slots.find((s) => s.id === slotId);
  const routePattern = slotSpec?.routes[0] ?? "/*";

  const manifestToml = serializeLimbManifestToml({
    limb: {
      id: limbId,
      name: displayName,
      version: "0.1.0",
      level,
      author: "uid:developer",
      description: `Scaffolded ${basePack.manifest.base.name} Limb`,
    },
    requires: {
      contract: ">=1.0",
      base: basePack.manifest.base.id,
      slots: [slotId],
    },
    ui: [
      {
        slot: slotId,
        route_pattern: routePattern,
        component: "ui/Widget.html",
        isolation: "iframe",
      },
    ],
    ...(level === 2
      ? {
          functions: [
            {
              route: `/_limb/${limbId}/notes`,
              method: "POST",
              handler: "functions/notes.ts",
            },
          ],
        }
      : {}),
    permissions: {
      data_read: basePack.manifest.permissions_catalog?.readable_collections?.includes("blogposts")
        ? ["blogposts"]
        : [],
      data_write: [],
      egress: [],
      sidecar: "personal",
      max_memory_mb: 64,
      max_cpu_ms: 400,
    },
    sidecar: {
      migrations: "migrations/",
    },
  });

  const migrationSql = [
    "CREATE TABLE IF NOT EXISTS items (",
    "  id INTEGER PRIMARY KEY AUTOINCREMENT,",
    "  note TEXT NOT NULL,",
    "  created_at TEXT NOT NULL",
    ");",
    "",
  ].join("\n");

  const widgetTsx = `import { useState } from "preact/hooks";
import { executeSidecar, useSidecarQuery, useSlotContext } from "@newt/ui-sdk";

export default function Widget() {
  const ctx = useSlotContext();
  const [text, setText] = useState("");
  const { data, refetch } = useSidecarQuery<{ id: number; note: string }>(
    "personal",
    "SELECT id, note FROM items ORDER BY id DESC"
  );

  const save = async (e: Event) => {
    e.preventDefault();
    if (!text.trim()) return;
    await executeSidecar(
      "personal",
      "INSERT INTO items (note, created_at) VALUES (?, ?)",
      [text.trim(), new Date().toISOString()]
    );
    setText("");
    await refetch();
  };

  return (
    <section
      style={{
        background: "var(--newt-card)",
        color: "var(--newt-fg)",
        border: "1px solid var(--newt-border)",
        borderRadius: "var(--newt-radius)",
        padding: "14px",
      }}
    >
      <h2 style={{ margin: "0 0 8px", fontSize: "15px" }}>${displayName}</h2>
      <p style={{ margin: "0 0 10px", fontSize: "12px", color: "var(--newt-muted)" }}>
        Slot: {ctx.slotId} · Theme: {ctx.theme}
      </p>
      <form onSubmit={save} style={{ display: "flex", gap: "8px" }}>
        <input
          type="text"
          value={text}
          onInput={(e) => setText((e.target as HTMLInputElement).value)}
          placeholder="Add item..."
          style={{ flex: 1, padding: "6px 8px" }}
        />
        <button type="submit">Save</button>
      </form>
      <ul style={{ margin: "10px 0 0", paddingLeft: "18px", fontSize: "13px" }}>
        {data.map((row) => (
          <li key={row.id}>{row.note}</li>
        ))}
      </ul>
    </section>
  );
}
`;

  const filesToWrite: Record<string, string> = {
    "limb.toml": manifestToml,
    "migrations/001_init.sql": migrationSql,
    "src/ui/Widget.tsx": widgetTsx,
    "newt.config.json": `${JSON.stringify({ base: options.base ?? "xkmato", outDir: "dist-limb" }, null, 2)}\n`,
  };

  if (level === 2) {
    filesToWrite["src/functions/notes.ts"] = [
      '// @host: {"host_call":"sidecar_execute","scope":"personal","sql_template":"INSERT INTO items (note, created_at) VALUES (\'${body.note}\', \'2026-11-24T00:00:00Z\')"}',
      '// @host: {"host_call":"sidecar_query","scope":"personal","sql_template":"SELECT id, note FROM items ORDER BY id DESC"}',
      "export async function handler(req: { body?: { note?: string } }) {",
      "  return { ok: true, note: req.body?.note ?? '' };",
      "}",
      "",
    ].join("\n");
  }

  const createdFiles: string[] = [];
  for (const [relPath, content] of Object.entries(filesToWrite)) {
    const dest = path.join(targetDir, relPath);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, content, "utf8");
    createdFiles.push(relPath);
  }

  io.stdout(`Initialized Newt Limb '${limbId}' in ${targetDir}`);
  for (const f of createdFiles) {
    io.stdout(`  + ${f}`);
  }
  return { dir: targetDir, limbId, files: createdFiles };
}

export interface BuildOptions {
  dir: string;
  outDir?: string;
  base?: string;
  shared?: boolean;
}

export async function runBuildCommand(
  options: BuildOptions,
  io: CliIo = DEFAULT_IO
): Promise<{ outDir: string; bundle: CompiledLimbBundle }> {
  const projectDir = path.resolve(options.dir);
  const configPath = path.join(projectDir, "newt.config.json");
  let configBase: string | undefined;
  let configOutDir: string | undefined;
  if (fs.existsSync(configPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
        base?: string;
        outDir?: string;
      };
      configBase = cfg.base;
      configOutDir = cfg.outDir;
    } catch {
      // ignore invalid config
    }
  }

  const basePack = resolveBasePackArg(options.base ?? configBase ?? "xkmato", projectDir);
  const vfs = loadDirectoryToVfs(projectDir);
  const bundle = await compileLimbVfs(vfs, {
    platformManifest: basePack.manifest,
    baseSpec: basePack.baseSpec,
    isSharedPublication: options.shared ?? false,
    runSmokeTest: true,
  });

  if (!bundle.valid) {
    for (const d of bundle.diagnostics) {
      io.stderr(`[${d.code}] (${d.severity}) ${d.path}: ${d.message}`);
    }
    return { outDir: path.resolve(projectDir, options.outDir ?? configOutDir ?? "dist-limb"), bundle };
  }

  const outDir = path.resolve(projectDir, options.outDir ?? configOutDir ?? "dist-limb");
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  fs.writeFileSync(path.join(outDir, "limb.toml"), bundle.manifestToml, "utf8");
  for (const [assetPath, content] of Object.entries(bundle.assets)) {
    const dest = path.join(outDir, assetPath);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, content, "utf8");
  }

  fs.writeFileSync(
    path.join(outDir, "build-manifest.json"),
    `${JSON.stringify(
      {
        limbId: bundle.limbId,
        base: basePack.manifest.base.id,
        assets: Object.keys(bundle.assets).sort(),
        bundleSizesBytes: bundle.bundleSizesBytes,
        requiresEgressConsent: bundle.requiresEgressConsent,
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  io.stdout(`Built Limb '${bundle.limbId}' -> ${outDir}`);
  for (const [asset, bytes] of Object.entries(bundle.bundleSizesBytes)) {
    io.stdout(`  • ${asset} (${(bytes / 1024).toFixed(1)} KB)`);
  }
  return { outDir, bundle };
}

export interface ValidateOptions {
  dir: string;
  base?: string;
  shared?: boolean;
  json?: boolean;
  salamandaUrl?: string;
}

export async function runValidateCommand(
  options: ValidateOptions,
  io: CliIo = DEFAULT_IO
): Promise<{ valid: boolean; diagnostics: CompiledLimbBundle["diagnostics"] }> {
  const projectDir = path.resolve(options.dir);
  const vfs = loadDirectoryToVfs(projectDir);

  if (options.salamandaUrl) {
    const client = new SalamandaControlPlaneClient({
      controlPlaneUrl: options.salamandaUrl,
      clientId: process.env.SALAMANDA_CLIENT_ID ?? "newt-cli",
      clientKey: process.env.SALAMANDA_CLIENT_KEY ?? "",
    });
    const report = await client.validateLimb(vfs["limb.toml"] ?? "", options.shared ?? false);
    if (options.json) {
      io.stdout(JSON.stringify(report, null, 2));
    } else {
      io.stdout(report.valid ? `VALID (${report.limb_id})` : `INVALID (${report.limb_id})`);
      for (const d of report.diagnostics) {
        io.stderr(`[${d.code}] (${d.severity}) ${d.path}: ${d.message}`);
      }
    }
    return { valid: report.valid, diagnostics: report.diagnostics };
  }

  const basePack = resolveBasePackArg(options.base ?? "xkmato", projectDir);
  const bundle = await compileLimbVfs(vfs, {
    platformManifest: basePack.manifest,
    baseSpec: basePack.baseSpec,
    isSharedPublication: options.shared ?? false,
    runSmokeTest: true,
  });

  if (options.json) {
    io.stdout(
      JSON.stringify(
        {
          valid: bundle.valid,
          limb_id: bundle.limbId,
          diagnostics: bundle.diagnostics,
          bundleSizesBytes: bundle.bundleSizesBytes,
        },
        null,
        2
      )
    );
  } else {
    io.stdout(
      bundle.valid
        ? `✓ VALID Limb '${bundle.limbId}' (0 errors)`
        : `✗ INVALID Limb '${bundle.limbId}'`
    );
    for (const d of bundle.diagnostics) {
      const target = d.severity === "error" ? io.stderr : io.stdout;
      target(`  [${d.code}] (${d.severity}) ${d.path}: ${d.message}`);
    }
  }

  return { valid: bundle.valid, diagnostics: bundle.diagnostics };
}

export interface InspectUrlOptions {
  url: string;
  outPath?: string;
}

export async function runInspectUrlCommand(
  options: InspectUrlOptions,
  io: CliIo = DEFAULT_IO
): Promise<{
  source: "well-known" | "html-auto-inspect";
  manifest: AmphibianPlatformManifest;
}> {
  const parsed = new URL(options.url);
  let source: "well-known" | "html-auto-inspect" = "html-auto-inspect";
  let manifest: AmphibianPlatformManifest | null = null;

  const wellKnownUrl = new URL("/.well-known/amphibian.json", parsed.origin).toString();
  try {
    const wkRes = await fetch(wellKnownUrl, { signal: AbortSignal.timeout(5000) });
    if (wkRes.ok) {
      const candidate = (await wkRes.json()) as AmphibianPlatformManifest;
      const check = validatePlatformManifest(candidate);
      if (check.valid) {
        manifest = candidate;
        source = "well-known";
      }
    }
  } catch {
    // Fallback to HTML auto-inspection
  }

  if (!manifest) {
    const res = await fetch(options.url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} fetching ${options.url}`);
    }
    const html = await res.text();
    manifest = synthesizeManifestFromHtml(options.url, html);
    source = "html-auto-inspect";
  }

  const outJson = `${JSON.stringify(manifest, null, 2)}\n`;
  if (options.outPath) {
    const outFile = path.resolve(options.outPath);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, outJson, "utf8");
    const slotsPath = path.join(path.dirname(outFile), "slots.json");
    fs.writeFileSync(
      slotsPath,
      `${JSON.stringify(toSalamandaSlotsManifest(manifest), null, 2)}\n`,
      "utf8"
    );
    io.stdout(`Inspected ${options.url} (${source}) -> ${outFile}`);
  } else {
    io.stdout(outJson);
  }

  return { source, manifest };
}

export async function runDevCommand(
  options: { dir: string; port?: number; base?: string },
  io: CliIo = DEFAULT_IO
): Promise<{ server: http.Server; url: string; close: () => Promise<void> }> {
  const projectDir = path.resolve(options.dir);
  const basePack = resolveBasePackArg(options.base ?? "xkmato", projectDir);
  let latestBundle = await compileLimbVfs(loadDirectoryToVfs(projectDir), {
    platformManifest: basePack.manifest,
    baseSpec: basePack.baseSpec,
    runSmokeTest: true,
  });

  const recompile = async () => {
    latestBundle = await compileLimbVfs(loadDirectoryToVfs(projectDir), {
      platformManifest: basePack.manifest,
      baseSpec: basePack.baseSpec,
      runSmokeTest: true,
    });
    io.stdout(
      `[newt dev] Recompiled '${latestBundle.limbId}' — ${latestBundle.valid ? "VALID" : "ERRORS"}`
    );
  };

  let watcher: fs.FSWatcher | null = null;
  try {
    watcher = fs.watch(projectDir, { recursive: true }, (_ev, filename) => {
      if (!filename || filename.includes("dist-limb") || filename.includes("node_modules")) return;
      void recompile();
    });
  } catch {
    // Recursive fs.watch may not be available on some filesystems
  }

  const server = http.createServer((req, res) => {
    if (req.url === "/status.json") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          valid: latestBundle.valid,
          limbId: latestBundle.limbId,
          diagnostics: latestBundle.diagnostics,
          assets: Object.keys(latestBundle.assets),
        })
      );
      return;
    }

    const firstAsset = Object.keys(latestBundle.assets).find((k) => k.endsWith(".html"));
    if (req.url === "/preview.html" && firstAsset) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(latestBundle.assets[firstAsset]);
      return;
    }

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Newt Dev — ${latestBundle.limbId}</title></head>` +
        `<body style="font-family:system-ui;padding:24px;max-width:760px;margin:0 auto;">` +
        `<h1>Newt Dev Preview: ${latestBundle.limbId}</h1>` +
        `<p>Status: <strong>${latestBundle.valid ? "VALID" : "ERROR"}</strong></p>` +
        (firstAsset
          ? `<iframe sandbox="allow-scripts" src="/preview.html" style="width:100%;height:360px;border:1px solid #ccc;border-radius:10px;"></iframe>`
          : `<pre>${JSON.stringify(latestBundle.diagnostics, null, 2)}</pre>`) +
        `</body></html>`
    );
  });

  await new Promise<void>((resolve) => {
    server.listen(options.port ?? 4173, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  const actualPort = typeof addr === "object" && addr ? addr.port : (options.port ?? 4173);
  const url = `http://127.0.0.1:${actualPort}`;
  io.stdout(`Newt dev preview running at ${url}`);

  return {
    server,
    url,
    close: () =>
      new Promise<void>((resolve) => {
        watcher?.close();
        server.close(() => resolve());
      }),
  };
}

export function runStudioCommand(
  options: { port?: number },
  io: CliIo = DEFAULT_IO
): Promise<number> {
  const studioDir = path.resolve(__dirname, "../../../apps/studio");
  const port = String(options.port ?? 3100);
  io.stdout(`Launching Newt Studio on http://127.0.0.1:${port} ...`);

  return new Promise<number>((resolve, reject) => {
    const child = spawn("pnpm", ["exec", "next", "dev", "-p", port], {
      cwd: studioDir,
      stdio: "inherit",
      env: process.env,
    });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 0));
  });
}

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export async function runDoctorCommand(
  options: { salamandaUrl?: string } = {},
  io: CliIo = DEFAULT_IO
): Promise<{ ok: boolean; checks: DoctorCheck[] }> {
  const checks: DoctorCheck[] = [];

  const majorNode = Number(process.versions.node.split(".")[0]);
  checks.push({
    name: "node",
    ok: majorNode >= 22,
    detail: `Node.js v${process.versions.node} (requires >=22 for node:sqlite)`,
  });

  let sqliteOk = false;
  try {
    await import("node:sqlite");
    sqliteOk = true;
  } catch {
    sqliteOk = false;
  }
  checks.push({
    name: "node:sqlite",
    ok: sqliteOk,
    detail: sqliteOk ? "Built-in node:sqlite available" : "node:sqlite unavailable",
  });

  const providerName = (process.env.NEWT_LLM_PROVIDER ?? "gemini").toLowerCase();
  const hasKey = Boolean(
    process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      process.env.ANTHROPIC_API_KEY ||
      process.env.OPENAI_API_KEY ||
      providerName === "ollama"
  );
  checks.push({
    name: "llm-provider",
    ok: true,
    detail: hasKey
      ? `Configured live provider '${providerName}'`
      : `No live API key set (Studio will use built-in deterministic offline mode; set GEMINI_API_KEY for live Gemini)`,
  });

  const salamandaUrl =
    options.salamandaUrl ?? process.env.SALAMANDA_CONTROL_PLANE_URL ?? "http://127.0.0.1:7474";
  let salDetail = `Not running at ${salamandaUrl} (optional for standalone Studio/offline CLI)`;
  try {
    const res = await fetch(`${salamandaUrl.replace(/\/+$/, "")}/v1/capabilities`, {
      signal: AbortSignal.timeout(1200),
    });
    if (res.ok) {
      salDetail = `Reachable at ${salamandaUrl}`;
    }
  } catch {
    // optional
  }
  checks.push({
    name: "salamanda-daemon",
    ok: true,
    detail: salDetail,
  });

  const allOk = checks.every((c) => c.ok);
  for (const c of checks) {
    io.stdout(`${c.ok ? "✓" : "✗"} ${c.name}: ${c.detail}`);
  }
  return { ok: allOk, checks };
}
