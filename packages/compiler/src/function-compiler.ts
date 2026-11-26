import type { Diagnostic, LimbManifest } from "@newt/contract";
import type { CompiledFunctionDescriptor, HostApiCall, NewtVfs } from "./types.js";

const FORBIDDEN_PATTERNS = [
  "process.env",
  "child_process",
  "require(",
  "Deno.",
  "eval(",
  "new Function(",
] as const;

function resolveHandlerSource(vfs: NewtVfs, handlerPath: string): {
  foundPath: string;
  source: string;
} | null {
  const candidates = [
    handlerPath,
    `src/${handlerPath}`,
    handlerPath.replace(/\.js$/, ".ts"),
    `src/${handlerPath.replace(/\.js$/, ".ts")}`,
  ];
  for (const c of candidates) {
    if (vfs[c] !== undefined) {
      return { foundPath: c, source: vfs[c] };
    }
  }
  return null;
}

export function parseHostOperations(tsSource: string): HostApiCall[] {
  const trimmed = tsSource.trim();
  if (trimmed.startsWith("[")) {
    return JSON.parse(trimmed) as HostApiCall[];
  }

  const ops: HostApiCall[] = [];
  for (const line of tsSource.split("\n")) {
    const clean = line.trim();
    if (clean.startsWith("// @host:")) {
      const jsonPart = clean.slice("// @host:".length).trim();
      const parsed = JSON.parse(jsonPart) as HostApiCall;
      ops.push(parsed);
    }
  }
  return ops;
}

function hasExportedJsHandler(source: string): boolean {
  return /\bexport\s+(default\s+)?(async\s+)?(function|const|let)\b/.test(source);
}

/**
 * Stage 3: Verifies Level 2 function handlers against Salamanda's
 * `salamanda-functions` static guard (`transpile_and_guard_ts`), parses `@host:`
 * operations, and cross-checks scopes against `limb.toml` `[permissions]`.
 * When `options.l2JsRuntime` is true (runtime advertises `l2_js_runtime`), standard
 * exported JS/TS handlers without `// @host:` directives are also permitted.
 */
export function compileAndVerifyFunctions(
  vfs: NewtVfs,
  manifest: LimbManifest,
  options: { l2JsRuntime?: boolean } = {}
): {
  diagnostics: Diagnostic[];
  functionAssets: Record<string, string>;
  descriptors: CompiledFunctionDescriptor[];
} {
  const diagnostics: Diagnostic[] = [];
  const functionAssets: Record<string, string> = {};
  const descriptors: CompiledFunctionDescriptor[] = [];

  for (const [idx, fnSpec] of (manifest.functions ?? []).entries()) {
    const resolved = resolveHandlerSource(vfs, fnSpec.handler);
    if (!resolved) {
      diagnostics.push({
        code: "NEWT-FN-002",
        severity: "error",
        path: `functions[${idx}].handler`,
        message: `Function handler file '${fnSpec.handler}' not found in project VFS.`,
        hint: `Create '${fnSpec.handler}' or 'src/${fnSpec.handler}'.`,
      });
      continue;
    }

    const { foundPath, source } = resolved;

    // 1. Forbidden global escape guard (`salamanda-functions::transpile_and_guard_ts`)
    let blocked = false;
    for (const pat of FORBIDDEN_PATTERNS) {
      if (source.includes(pat)) {
        diagnostics.push({
          code: "NEWT-FN-001",
          severity: "error",
          path: foundPath,
          message: `Forbidden ambient global or dynamic codegen '${pat}' detected in '${foundPath}'.`,
          hint: "Salamanda L2 functions run with zero ambient Node/Deno globals; use @host directives.",
          suggested_fix: `Remove '${pat}' from '${foundPath}'.`,
        });
        blocked = true;
      }
    }
    if (blocked) continue;

    // 2. Parse `@host:` directives (`salamanda-functions::parse_handler_operations`)
    let ops: HostApiCall[] = [];
    try {
      ops = parseHostOperations(source);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      diagnostics.push({
        code: "NEWT-FN-002",
        severity: "error",
        path: foundPath,
        message: `Invalid // @host: JSON directive in '${foundPath}': ${msg}`,
        hint: 'Format directives as: // @host: {"host_call":"sidecar_query","scope":"personal","sql_template":"SELECT ..."}',
      });
      continue;
    }

    if (ops.length === 0) {
      if (options.l2JsRuntime && hasExportedJsHandler(source)) {
        // Runtime advertises embedded JS runtime (`l2_js_runtime`): allow standard exported JS handler
      } else {
        diagnostics.push({
          code: "NEWT-FN-002",
          severity: "error",
          path: foundPath,
          message: options.l2JsRuntime
            ? `Handler '${foundPath}' must export a handler function or include // @host: directives.`
            : `Handler '${foundPath}' contains no executable // @host: directives.`,
          hint: options.l2JsRuntime
            ? "Export a handler (`export default async function handler(req, host) { ... }`) or add // @host: directives."
            : "Salamanda v1.0 L2 handlers require at least one // @host: directive.",
        });
        continue;
      }
    }

    // 3. Cross-check every HostApiCall against `manifest.permissions`
    for (const op of ops) {
      if (op.host_call === "sidecar_query" || op.host_call === "sidecar_execute") {
        if (manifest.permissions.sidecar !== op.scope) {
          diagnostics.push({
            code: "NEWT-FN-003",
            severity: "error",
            path: foundPath,
            message: `Handler '${foundPath}' requests sidecar scope '${op.scope}', but limb.toml grants '${manifest.permissions.sidecar}'.`,
            suggested_fix: `Set permissions.sidecar = "${op.scope}" in limb.toml or change @host scope.`,
          });
        }
      } else if (op.host_call === "canonical_read") {
        if (!manifest.permissions.data_read.includes(op.collection)) {
          diagnostics.push({
            code: "NEWT-FN-003",
            severity: "error",
            path: foundPath,
            message: `Handler '${foundPath}' reads canonical collection '${op.collection}', which is not listed in permissions.data_read.`,
            suggested_fix: `Add "${op.collection}" to permissions.data_read in limb.toml.`,
          });
        }
      } else if (op.host_call === "http_fetch") {
        let hostname = "";
        try {
          hostname = new URL(op.url).hostname;
        } catch {
          diagnostics.push({
            code: "NEWT-FN-003",
            severity: "error",
            path: foundPath,
            message: `Invalid URL '${op.url}' in http_fetch @host directive.`,
          });
          continue;
        }
        const allowed = manifest.permissions.egress.some(
          (h) => h.toLowerCase() === hostname.toLowerCase()
        );
        if (!allowed) {
          diagnostics.push({
            code: "NEWT-FN-003",
            severity: "error",
            path: foundPath,
            message: `Handler '${foundPath}' fetches '${hostname}', which is not declared in permissions.egress.`,
            suggested_fix: `Add "${hostname}" to permissions.egress in limb.toml.`,
          });
        }
      }
    }

    functionAssets[fnSpec.handler] = source;
    descriptors.push({
      route: fnSpec.route,
      method: fnSpec.method.toUpperCase(),
      handlerPath: fnSpec.handler,
      tsSource: source,
      operations: ops,
    });
  }

  return { diagnostics, functionAssets, descriptors };
}
