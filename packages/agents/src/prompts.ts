import {
  type AmphibianPlatformManifest,
  formatPlatformContextForAgent,
} from "@newt/base-sdk";
import type { Diagnostic } from "@newt/contract";
import type { NewtVfs } from "@newt/compiler";
import type { LimbBlueprint } from "./types.js";

const SALAMANDA_CONTRACT_RULES = `
## Salamanda Public Contract v1.0.0 Rules
- Always pick the LOWEST extension level that satisfies the user's request:
  - level = 1: UI mounted into named slots + optional sidecar SQLite database (no server [[functions]], no external egress).
  - level = 2: level 1 + sandboxed server [[functions]] under \`/_limb/<limb.id>/...\` and/or allow-listed external HTTPS \`permissions.egress\`.
- \`limb.id\` must match \`^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$\`.
- Always set \`isolation = "iframe"\` on every \`[[ui]]\` mount so limbs are safe to share.
- Keep \`data_write = []\`. Store all custom state in \`sidecar = "personal"\` or \`"shared"\`.
- Never declare private/sensitive collections in \`data_read\` and never declare internal/loopback/metadata IPs in \`egress\`.
- For \`level = 2\` handlers in \`src/functions/*.ts\`, include executable \`// @host: {...}\` directives:
  - \`// @host: {"host_call":"sidecar_execute","scope":"personal","sql_template":"INSERT ..."}\`
  - \`// @host: {"host_call":"sidecar_query","scope":"personal","sql_template":"SELECT ..."}\`
  - \`// @host: {"host_call":"canonical_read","collection":"...","doc_id":"..."}\`
  - \`// @host: {"host_call":"http_fetch","url":"https://..."}\`
  Never use \`process.env\`, \`require(\`, \`child_process\`, \`Deno.\`, \`eval(\`, or \`new Function(\`.
`;

const UI_SDK_REFERENCE = `
## @newt/ui-sdk & Preact Authoring Contract
- Author modular Preact + TypeScript components in \`src/ui/<Name>.tsx\` with \`export default function ...\`.
- Import hooks from \`preact/hooks\` (\`useState\`, \`useEffect\`) and runtime helpers from \`@newt/ui-sdk\`:
  - \`useSlotContext<Record<string, string>>()\` -> \`{ limbId, slotId, cardinality, route, props, theme, ready }\`
  - \`useSidecarQuery<T>(scope, sql, params?)\` -> \`{ data, loading, error, refetch }\`
  - \`executeSidecar(scope, sql, params?)\`
  - \`readCanonical<T>(collection, docId)\`
  - \`invokeLimbFunction<Req, Res>(route, body, method?)\`
- Style using semantic CSS variables so the UI matches ANY host platform's light & dark themes automatically:
  \`var(--newt-bg)\`, \`var(--newt-card)\`, \`var(--newt-surface)\`, \`var(--newt-fg)\`, \`var(--newt-muted)\`, \`var(--newt-primary)\`, \`var(--newt-primary-fg)\`, \`var(--newt-accent)\`, \`var(--newt-border)\`, \`var(--newt-radius)\`.
- For \`repeater\` slots, keep UI compact and crisp (horizontal pill/toolbar); for \`singleton\` sidebar/header slots, render a polished card.
`;

export function buildArchitectPrompts(params: {
  sanitizedPrompt: string;
  platformManifest: AmphibianPlatformManifest;
  selectedSlot?: string;
  existingFiles?: string[];
  enableL3?: boolean;
}): { systemPrompt: string; userPrompt: string } {
  const platformDoc = formatPlatformContextForAgent(params.platformManifest, {
    enableL3: params.enableL3,
  });

  const systemPrompt = [
    "You are Newt's ArchitectAgent. Plan the minimal, safest, highest-craft Salamanda Limb blueprint for the target web platform.",
    SALAMANDA_CONTRACT_RULES,
    platformDoc,
    "Return strictly valid JSON matching the LimbBlueprint schema: { mode, limbId, displayName, description, level, rationale, uiMounts, sidecar, functions, permissions, designSpec }.",
  ].join("\n\n");

  const userParts = [
    `User Request: ${params.sanitizedPrompt}`,
    params.selectedSlot ? `Preferred Target Slot: ${params.selectedSlot}` : null,
    params.existingFiles?.length
      ? `Existing Project Files: ${params.existingFiles.join(", ")}`
      : null,
  ].filter(Boolean);

  return { systemPrompt, userPrompt: userParts.join("\n") };
}

export function buildDataAndFunctionsPrompts(params: {
  blueprint: LimbBlueprint;
  authorUid: string;
  platformManifest: AmphibianPlatformManifest;
}): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = [
    "You are Newt's DataAndFunctionsAgent. Generate `limb.toml`, SQLite `migrations/001_init.sql` (if sidecar != 'none'), optional `fixtures/seed.sql`, and L2 `src/functions/*.ts` handlers.",
    SALAMANDA_CONTRACT_RULES,
    `Target base id: "${params.platformManifest.base.id}". Author UID: "${params.authorUid}".`,
    "Every [[ui]].component path in limb.toml MUST match blueprint.uiMounts[i].compiledAsset (e.g. 'ui/Widget.html').",
    "Never use ATTACH or PRAGMA in SQLite migrations.",
    'Return strictly valid JSON: { "summary": string, "files": [{ "path": string, "content": string }] }.',
  ].join("\n\n");

  const userPrompt = `Blueprint JSON:\n${JSON.stringify(params.blueprint, null, 2)}`;
  return { systemPrompt, userPrompt };
}

export function buildUiCraftsmanPrompts(params: {
  blueprint: LimbBlueprint;
  platformManifest: AmphibianPlatformManifest;
  existingVfs?: NewtVfs;
}): { systemPrompt: string; userPrompt: string } {
  const platformDoc = formatPlatformContextForAgent(params.platformManifest);
  const systemPrompt = [
    "You are Newt's UiCraftsmanAgent. Build accessible, responsive, high-craft Preact + TypeScript UI components for each mount in blueprint.uiMounts.",
    UI_SDK_REFERENCE,
    platformDoc,
    "Write each component to its exact `blueprint.uiMounts[i].entryFile` path (e.g. `src/ui/Widget.tsx`).",
    'Return strictly valid JSON: { "summary": string, "files": [{ "path": string, "content": string }] }.',
  ].join("\n\n");

  const existingUiSnippets = Object.entries(params.existingVfs ?? {})
    .filter(([p]) => p.startsWith("src/ui/"))
    .map(([p, c]) => `--- ${p} ---\n${c}`)
    .join("\n\n");

  const userPrompt = [
    `Blueprint JSON:\n${JSON.stringify(params.blueprint, null, 2)}`,
    existingUiSnippets ? `Existing UI Files:\n${existingUiSnippets}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  return { systemPrompt, userPrompt };
}

export function buildRepairPrompts(params: {
  blueprint: LimbBlueprint;
  vfs: NewtVfs;
  diagnostics: Diagnostic[];
  platformManifest: AmphibianPlatformManifest;
}): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = [
    "You are Newt's RepairAgent. Fix ALL error-severity diagnostics cleanly with minimal surgical file edits.",
    SALAMANDA_CONTRACT_RULES,
    UI_SDK_REFERENCE,
    formatPlatformContextForAgent(params.platformManifest),
    'Return strictly valid JSON: { "diagnosis": string, "edits": [{ "path": string, "content": string }] }.',
  ].join("\n\n");

  const fileDump = Object.entries(params.vfs)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([p, c]) => `=== FILE: ${p} ===\n${c}`)
    .join("\n\n");

  const userPrompt = [
    `Diagnostics to resolve:\n${JSON.stringify(params.diagnostics, null, 2)}`,
    `Current Project VFS:\n${fileDump}`,
  ].join("\n\n");

  return { systemPrompt, userPrompt };
}
