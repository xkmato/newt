import { z } from "zod";
import type { AmphibianPlatformManifest } from "@newt/base-sdk";
import type { CompiledLimbBundle, NewtVfs } from "@newt/compiler";
import type { BaseSpec, Diagnostic } from "@newt/contract";

export interface LlmUsage {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface LlmGenerateJsonRequest {
  role: "architect" | "data-functions" | "ui-craftsman" | "variant-patch" | "repair";
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
}

export interface LlmGenerateJsonResponse<T = unknown> {
  data: T;
  usage: LlmUsage;
}

export interface LlmProvider {
  readonly providerName: string;
  readonly modelName: string;
  generateJson<T = unknown>(
    req: LlmGenerateJsonRequest
  ): Promise<LlmGenerateJsonResponse<T>>;
}

export const LimbBlueprintSchema = z.object({
  mode: z.enum(["standalone-ui", "salamanda-limb"]).default("salamanda-limb"),
  limbId: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/, "limbId must be a lowercase URL-safe slug"),
  displayName: z.string().min(1).max(120),
  description: z.string().max(1000).default(""),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  rationale: z.string().min(1),
  uiMounts: z
    .array(
      z.object({
        slot: z.string().min(1),
        routePattern: z.string().default("/*"),
        entryFile: z.string().min(1),
        compiledAsset: z.string().min(1),
        isolation: z.enum(["iframe", "same-origin-personal"]).default("iframe"),
      })
    )
    .default([]),
  patch: z
    .object({
      diffFile: z.string().default("patches/variant.patch"),
      touches: z.array(z.string().min(1)).default([]),
      summary: z.string().default("Minimal unified git diff for Level 3 variant"),
    })
    .optional(),
  sidecar: z.object({
    scope: z.enum(["none", "personal", "shared", "scratch"]),
    tables: z
      .array(
        z.object({
          name: z.string().min(1),
          ddlSummary: z.string().min(1),
        })
      )
      .default([]),
  }),
  functions: z
    .array(
      z.object({
        method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
        route: z.string().min(1),
        sourceFile: z.string().min(1),
        hostOperations: z
          .array(z.enum(["sidecar_query", "sidecar_execute", "canonical_read", "http_fetch"]))
          .default([]),
      })
    )
    .default([]),
  permissions: z.object({
    dataRead: z.array(z.string()).default([]),
    egress: z.array(z.string()).default([]),
    maxMemoryMb: z.number().int().min(16).max(2048).default(64),
    maxCpuMs: z.number().int().min(10).max(30000).default(500),
  }),
  designSpec: z.object({
    layoutPattern: z.string().default("card"),
    semanticTokensUsed: z.array(z.string()).default(["--newt-card", "--newt-fg", "--newt-border"]),
    states: z.array(z.string()).default(["loading", "empty", "populated", "error"]),
    accessibilityNotes: z.string().default("Keyboard navigable with ARIA labels"),
  }),
});

export type LimbBlueprint = z.infer<typeof LimbBlueprintSchema>;

export const FileSynthesisBatchSchema = z.object({
  summary: z.string().default("Synthesized files"),
  files: z
    .array(
      z.object({
        path: z.string().min(1),
        content: z.string(),
      })
    )
    .min(1),
});

export type FileSynthesisBatch = z.infer<typeof FileSynthesisBatchSchema>;

export const VariantPatchBatchSchema = z.object({
  summary: z.string().default("Synthesized Level 3 unified git patch"),
  diffFile: z.string().default("patches/variant.patch"),
  diff: z.string().min(1),
  touches: z.array(z.string().min(1)).optional(),
});

export type VariantPatchBatch = z.infer<typeof VariantPatchBatchSchema>;

export const RepairPatchBatchSchema = z.object({
  diagnosis: z.string().min(1),
  edits: z
    .array(
      z.object({
        path: z.string().min(1),
        content: z.string(),
      })
    )
    .min(1),
});

export type RepairPatchBatch = z.infer<typeof RepairPatchBatchSchema>;

export type AgentTurnEvent =
  | { type: "gatekeeper.passed"; sanitizedPrompt: string }
  | { type: "gatekeeper.blocked"; reason: string; code: string }
  | { type: "blueprint.ready"; blueprint: LimbBlueprint }
  | {
      type: "synthesis.started";
      agents: Array<"data-functions" | "ui-craftsman" | "variant-patch">;
    }
  | { type: "vfs.updated"; paths: string[]; summary: string }
  | { type: "compile.result"; valid: boolean; diagnostics: Diagnostic[] }
  | { type: "repair.attempt"; attempt: number; maxAttempts: number; errorCount: number }
  | { type: "turn.complete"; valid: boolean; repairAttempts: number; requiresEgressConsent: boolean }
  | { type: "turn.error"; message: string };

export interface RebaseConflictContext {
  baseCommit: string;
  conflictReason: string;
  upstreamFiles?: Record<string, string>;
}

export interface OrchestratorRequest {
  prompt: string;
  authorUid: string;
  platformManifest: AmphibianPlatformManifest;
  baseSpec: BaseSpec;
  provider: LlmProvider;
  existingVfs?: NewtVfs;
  selectedSlot?: string;
  isSharedPublication?: boolean;
  approvedEgressHosts?: string[];
  /** Opened in Task 6.1 — requires both `enableL3: true` AND base `allow_levels` including `3` */
  enableL3?: boolean;
  /** Optional snapshot of base source files for `VariantPatchAgent` context */
  baseSourceFiles?: Record<string, string>;
  /** Optional rebase conflict context when self-repairing a `Stale` Level 3 Variant */
  rebaseConflict?: RebaseConflictContext;
  /** Optional host page content/context — always fenced as untrusted data in prompts */
  untrustedHostContext?: string;
  /** True when Salamanda advertises `features.l2_js_runtime` in `GET /v1/capabilities` */
  l2JsRuntime?: boolean;
  maxRepairAttempts?: number;
  runSmokeTest?: boolean;
  onEvent?: (event: AgentTurnEvent) => void;
}

export interface OrchestratorResult {
  ok: boolean;
  status: "ready" | "blocked" | "repair_exhausted" | "error";
  blockReason?: string;
  blueprint?: LimbBlueprint;
  vfs: NewtVfs;
  compiled?: CompiledLimbBundle;
  repairAttempts: number;
  totalUsage: {
    inputTokens: number;
    outputTokens: number;
    calls: LlmUsage[];
  };
  events: AgentTurnEvent[];
}
