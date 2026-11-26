import type { AmphibianPlatformManifest } from "@newt/base-sdk";
import type {
  BaseSpec,
  Diagnostic,
  LimbManifest,
  SidecarScope,
} from "@newt/contract";

/**
 * In-memory Virtual File System mapping relative paths (e.g. `limb.toml`,
 * `src/ui/Notes.tsx`, `src/functions/vote.ts`, `migrations/001_init.sql`) to UTF-8 text.
 */
export type NewtVfs = Record<string, string>;

export interface CompileOptions {
  platformManifest: AmphibianPlatformManifest;
  baseSpec: BaseSpec;
  isSharedPublication?: boolean;
  /** Egress hostnames already approved by the user in prior checkpoints */
  approvedEgressHosts?: string[];
  /** Defaults to `true` — mounts compiled `srcdoc` in headless JSDOM to catch runtime crashes */
  runSmokeTest?: boolean;
  /** Maximum uncompressed HTML bundle size per UI slot (defaults to 150 KB = 153600 bytes) */
  maxBundleBytes?: number;
  /**
   * Set to `true` when Salamanda `GET /v1/capabilities` advertises `features.l2_js_runtime`
   * (embedded JS runtime such as QuickJS). When `false`/unset (default v1.0), L2 handlers
   * must include executable `// @host:` DSL directives.
   */
  l2JsRuntime?: boolean;
}

export type HostApiCall =
  | {
      host_call: "sidecar_execute";
      scope: SidecarScope;
      sql_template: string;
    }
  | {
      host_call: "sidecar_query";
      scope: SidecarScope;
      sql_template: string;
    }
  | {
      host_call: "canonical_read";
      collection: string;
      doc_id: string;
    }
  | {
      host_call: "http_fetch";
      url: string;
    };

export interface CompiledFunctionDescriptor {
  route: string;
  method: string;
  handlerPath: string;
  tsSource: string;
  operations: HostApiCall[];
}

export interface CompiledVariantPatch {
  diffFile: string;
  digest: string;
  touches: string[];
  diff: string;
}

export interface CompiledLimbBundle {
  valid: boolean;
  limbId: string;
  manifest?: LimbManifest;
  manifestToml: string;
  /** Ready-to-upload `assets` map for Salamanda `POST /v1/limbs` */
  assets: Record<string, string>;
  functions: CompiledFunctionDescriptor[];
  /** Verified Level 3 unified git diff & digest (populated when `level = 3`) */
  variantPatch?: CompiledVariantPatch;
  diagnostics: Diagnostic[];
  requiresEgressConsent: boolean;
  unapprovedEgressHosts: string[];
  bundleSizesBytes: Record<string, number>;
}
