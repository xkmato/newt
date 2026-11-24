import crypto from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";
import {
  type AmphibianPlatformManifest,
  compileThemeTokenStylesheet,
  type SlotCardinality,
} from "@newt/base-sdk";
import type { Diagnostic, LimbUiMount } from "@newt/contract";
import type { NewtVfs } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UI_SDK_ENTRY = path.resolve(__dirname, "../../ui-sdk/src/index.ts");
const requireFromCompiler = createRequire(import.meta.url);

const PROBE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".css", ".json"];

function sha256Base64(scriptBody: string): string {
  return crypto.createHash("sha256").update(scriptBody, "utf8").digest("base64");
}

function escapeInlineScript(js: string): string {
  return js.replace(/<\/script/gi, "<\\/script");
}

function resolveVfsPath(vfs: NewtVfs, candidate: string): string | null {
  const clean = candidate.replace(/^\.\//, "");
  if (vfs[clean] !== undefined) return clean;
  for (const ext of PROBE_EXTENSIONS) {
    if (vfs[`${clean}${ext}`] !== undefined) return `${clean}${ext}`;
  }
  for (const ext of PROBE_EXTENSIONS) {
    if (vfs[`${clean}/index${ext}`] !== undefined) return `${clean}/index${ext}`;
  }
  return null;
}

function findUiEntryInVfs(vfs: NewtVfs, componentPath: string): {
  vfsPath: string;
  isRawHtml: boolean;
} | null {
  if (vfs[componentPath] !== undefined) {
    return {
      vfsPath: componentPath,
      isRawHtml: componentPath.endsWith(".html"),
    };
  }

  const baseNoExt = componentPath
    .replace(/^ui\//, "")
    .replace(/\.(html|js|jsx|ts|tsx)$/, "");

  const sourceCandidates = [
    `src/ui/${baseNoExt}.tsx`,
    `src/ui/${baseNoExt}.jsx`,
    `src/ui/${baseNoExt}.ts`,
    `src/ui/${baseNoExt}.js`,
    `ui/${baseNoExt}.tsx`,
    `ui/${baseNoExt}.ts`,
    `ui/${baseNoExt}.js`,
  ];

  for (const cand of sourceCandidates) {
    if (vfs[cand] !== undefined) {
      return { vfsPath: cand, isRawHtml: false };
    }
  }
  return null;
}

function wrapInSelfContainedSrcdoc(params: {
  limbId: string;
  slotId: string;
  cardinality: SlotCardinality;
  themeCss: string;
  bundledCss: string;
  bundledJs: string;
}): string {
  const bootPayload = JSON.stringify({
    limbId: params.limbId,
    slotId: params.slotId,
    cardinality: params.cardinality,
  });
  const bootScript = `window.__NEWT_BOOT__=${bootPayload};`;
  const combinedScript = `${bootScript}\n${escapeInlineScript(params.bundledJs)}`;
  const scriptHash = sha256Base64(combinedScript);

  const csp = [
    "default-src 'none'",
    `script-src 'sha256-${scriptHash}'`,
    "style-src 'unsafe-inline'",
    "img-src data: blob: https:",
    "media-src data: blob: https:",
    "font-src data: https:",
    "object-src 'none'",
    "base-uri 'none'",
  ].join("; ");

  const baseResetCss = `
*, *::before, *::after { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  background: transparent;
  color: var(--newt-fg);
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
`;

  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta http-equiv="Content-Security-Policy" content="${csp}">`,
    `<style id="newt-styles">${params.themeCss}\n${baseResetCss}\n${params.bundledCss}</style>`,
    "</head>",
    "<body>",
    '<div id="root"></div>',
    `<script>${combinedScript}</script>`,
    "</body>",
    "</html>",
  ].join("\n");
}

/**
 * Stage 4: Compiles a `[[ui]]` slot entry from `NewtVfs` (`src/ui/*.tsx` + Preact +
 * `@newt/ui-sdk` + scoped CSS + host `--newt-*` theme fallbacks) into a single
 * self-contained `ui/<Name>.html` bundle ready for Salamanda `<iframe sandbox="allow-scripts" srcdoc="...">`.
 */
export async function bundleUiMountToSrcdoc(params: {
  vfs: NewtVfs;
  limbId: string;
  uiMount: LimbUiMount;
  platformManifest: AmphibianPlatformManifest;
  maxBundleBytes?: number;
}): Promise<{
  html?: string;
  byteLength: number;
  diagnostics: Diagnostic[];
}> {
  const { vfs, limbId, uiMount, platformManifest } = params;
  const maxBytes = params.maxBundleBytes ?? 150 * 1024;
  const diagnostics: Diagnostic[] = [];

  const slotSpec = platformManifest.slots.find((s) => s.id === uiMount.slot);
  const cardinality: SlotCardinality = slotSpec?.cardinality ?? "singleton";
  const themeCss = compileThemeTokenStylesheet(platformManifest.theme);

  const entry = findUiEntryInVfs(vfs, uiMount.component);
  if (!entry) {
    diagnostics.push({
      code: "NEWT-UI-003",
      severity: "error",
      path: uiMount.component,
      message: `UI component source for '${uiMount.component}' was not found in project VFS.`,
      hint: `Create 'src/ui/${path.basename(uiMount.component, ".html")}.tsx' or '${uiMount.component}'.`,
    });
    return { byteLength: 0, diagnostics };
  }

  // Support raw HTML passthrough (for legacy/hand-authored limbs like Salamanda sample-limbs)
  if (entry.isRawHtml) {
    const rawHtml = vfs[entry.vfsPath] ?? "";
    const extraCss = uiMount.style && vfs[uiMount.style] ? vfs[uiMount.style] ?? "" : "";
    const wrappedRaw = rawHtml.includes("<!DOCTYPE html")
      ? rawHtml
      : [
          "<!DOCTYPE html><html><head><meta charset=\"utf-8\">",
          `<style>${themeCss}\n${extraCss}</style>`,
          `</head><body><div id="root">${rawHtml}</div></body></html>`,
        ].join("\n");
    const byteLength = Buffer.byteLength(wrappedRaw, "utf8");
    if (byteLength > maxBytes) {
      diagnostics.push({
        code: "NEWT-UI-002",
        severity: "error",
        path: entry.vfsPath,
        message: `Compiled UI bundle (${byteLength} bytes) exceeds budget (${maxBytes} bytes).`,
      });
    }
    return { html: wrappedRaw, byteLength, diagnostics };
  }

  const virtualEntryCode = `
import { h, render } from "preact";
import { autoResizeFrame } from "@newt/ui-sdk";
import * as Mod from "./${entry.vfsPath}";
${uiMount.style && vfs[uiMount.style] ? `import "./${uiMount.style}";` : ""}

const RootComponent = Mod.default ?? Mod.App ?? Mod.Widget;
const container = document.getElementById("root");
if (container && typeof RootComponent === "function") {
  render(h(RootComponent, null), container);
}
autoResizeFrame();
`;

  try {
    const result = await esbuild.build({
      stdin: {
        contents: virtualEntryCode,
        resolveDir: path.dirname(UI_SDK_ENTRY),
        sourcefile: "__newt_entry__.tsx",
        loader: "tsx",
      },
      bundle: true,
      minify: true,
      format: "iife",
      target: ["es2022"],
      jsx: "automatic",
      jsxImportSource: "preact",
      write: false,
      outdir: "/virtual-out",
      entryNames: "bundle",
      logLevel: "silent",
      plugins: [
        {
          name: "newt-vfs-resolver",
          setup(build) {
            build.onResolve({ filter: /^@newt\/ui-sdk$/ }, () => ({
              path: UI_SDK_ENTRY,
            }));

            build.onResolve(
              { filter: /^(preact|preact\/hooks|preact\/jsx-runtime|preact\/compat)$/ },
              (args) => ({
                path: requireFromCompiler.resolve(args.path),
              })
            );

            build.onResolve({ filter: /^(react|react-dom)$/ }, () => ({
              path: requireFromCompiler.resolve("preact/compat"),
            }));

            build.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({
              path: requireFromCompiler.resolve("preact/jsx-runtime"),
            }));

            build.onResolve({ filter: /^\.\.?\// }, (args) => {
              if (args.namespace === "newt-vfs") {
                const baseDir = path.posix.dirname(args.importer);
                const joined = path.posix.normalize(path.posix.join(baseDir, args.path));
                const hit = resolveVfsPath(vfs, joined);
                if (hit) return { path: hit, namespace: "newt-vfs" };
                return {
                  errors: [{ text: `Cannot resolve '${args.path}' from '${args.importer}' in VFS` }],
                };
              }

              // Imported from `__newt_entry__.tsx` stdin
              if (args.importer.endsWith("__newt_entry__.tsx")) {
                const hit = resolveVfsPath(vfs, args.path);
                if (hit) return { path: hit, namespace: "newt-vfs" };
              }
              return null;
            });

            build.onLoad({ filter: /.*/, namespace: "newt-vfs" }, (args) => {
              const contents = vfs[args.path];
              if (contents === undefined) {
                return { errors: [{ text: `VFS file not found: ${args.path}` }] };
              }
              const ext = path.extname(args.path);
              const loader: esbuild.Loader =
                ext === ".tsx"
                  ? "tsx"
                  : ext === ".ts"
                    ? "ts"
                    : ext === ".jsx"
                      ? "jsx"
                      : ext === ".css"
                        ? "css"
                        : ext === ".json"
                          ? "json"
                          : "js";
              return { contents, loader };
            });
          },
        },
      ],
    });

    let bundledJs = "";
    let bundledCss = "";
    for (const out of result.outputFiles) {
      if (out.path.endsWith(".js")) bundledJs = out.text;
      if (out.path.endsWith(".css")) bundledCss = out.text;
    }

    const html = wrapInSelfContainedSrcdoc({
      limbId,
      slotId: uiMount.slot,
      cardinality,
      themeCss,
      bundledCss,
      bundledJs,
    });

    const byteLength = Buffer.byteLength(html, "utf8");
    if (byteLength > maxBytes) {
      diagnostics.push({
        code: "NEWT-UI-002",
        severity: "error",
        path: entry.vfsPath,
        message: `Compiled UI bundle (${byteLength} bytes) exceeds budget (${maxBytes} bytes).`,
        hint: "Split heavy static data into sidecar SQLite tables or simplify dependencies.",
      });
    }

    return { html, byteLength, diagnostics };
  } catch (err) {
    const buildErr = err as { errors?: Array<{ text: string; location?: { file?: string; line?: number } }> };
    if (Array.isArray(buildErr.errors) && buildErr.errors.length > 0) {
      for (const e of buildErr.errors) {
        const loc = e.location?.file ? `${e.location.file}:${e.location.line ?? 1}` : entry.vfsPath;
        diagnostics.push({
          code: "NEWT-UI-001",
          severity: "error",
          path: loc,
          message: `UI bundle compile error: ${e.text}`,
          hint: "Fix TypeScript/JSX syntax or missing imports in src/ui/.",
        });
      }
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      diagnostics.push({
        code: "NEWT-UI-001",
        severity: "error",
        path: entry.vfsPath,
        message: `UI bundle compile error: ${msg}`,
      });
    }
    return { byteLength: 0, diagnostics };
  }
}
