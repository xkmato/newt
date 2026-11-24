import { toSalamandaSlotsManifest } from "@newt/base-sdk";
import {
  type Diagnostic,
  parseLimbManifestToml,
  validateLimbManifestToml,
} from "@newt/contract";
import { compileAndVerifyFunctions } from "./function-compiler.js";
import { runHeadlessUiSmokeCheck } from "./smoke-runner.js";
import { verifySidecarMigrations } from "./sql-verifier.js";
import type { CompiledLimbBundle, CompileOptions, NewtVfs } from "./types.js";
import { bundleUiMountToSrcdoc } from "./ui-bundler.js";

/**
 * Orchestrates the 6-stage deterministic Newt compilation & verification pipeline:
 * 1. `limb.toml` schema & `SAL-*` policy validation
 * 2. Sidecar SQLite migration & seed dry-run (`sql.js`)
 * 3. Level 2 TypeScript static guard & `@host:` scope cross-check
 * 4. Single-file Preact + `@newt/ui-sdk` + `--newt-*` CSS `srcdoc` bundling (with SHA-256 CSP)
 * 5. Headless JSDOM mount smoke test
 * 6. Deterministic Egress Diff Gate (`NEWT-CONSENT-001`)
 */
export async function compileLimbVfs(
  vfs: NewtVfs,
  options: CompileOptions
): Promise<CompiledLimbBundle> {
  const manifestToml = vfs["limb.toml"] ?? "";
  const slotsManifest = toSalamandaSlotsManifest(options.platformManifest);

  // Stage 1: Manifest & SAL-* policy validation
  const contractReport = validateLimbManifestToml(
    manifestToml,
    options.baseSpec,
    slotsManifest,
    options.isSharedPublication ?? false
  );

  const diagnostics: Diagnostic[] = [...contractReport.diagnostics];
  const assets: Record<string, string> = {};
  const bundleSizesBytes: Record<string, number> = {};

  if (!contractReport.valid) {
    return {
      valid: false,
      limbId: contractReport.limb_id,
      manifestToml,
      assets,
      functions: [],
      diagnostics,
      requiresEgressConsent: false,
      unapprovedEgressHosts: [],
      bundleSizesBytes,
    };
  }

  const manifest = parseLimbManifestToml(manifestToml);

  // Stage 2: Sidecar SQLite migration dry-run
  const sqlRes = await verifySidecarMigrations(
    vfs,
    manifest.permissions.sidecar,
    manifest.sidecar?.migrations ?? "migrations/"
  );
  diagnostics.push(...sqlRes.diagnostics);
  Object.assign(assets, sqlRes.migrationAssets);

  // Stage 3: Level 2 function static guard & @host verification
  const fnRes = compileAndVerifyFunctions(vfs, manifest);
  diagnostics.push(...fnRes.diagnostics);
  Object.assign(assets, fnRes.functionAssets);

  // Stage 4 & Stage 5: UI srcdoc bundling + headless JSDOM smoke check
  const runSmoke = options.runSmokeTest ?? true;
  for (const uiMount of manifest.ui ?? []) {
    const bundled = await bundleUiMountToSrcdoc({
      vfs,
      limbId: manifest.limb.id,
      uiMount,
      platformManifest: options.platformManifest,
      maxBundleBytes: options.maxBundleBytes,
    });
    diagnostics.push(...bundled.diagnostics);

    if (bundled.html && bundled.diagnostics.length === 0) {
      assets[uiMount.component] = bundled.html;
      bundleSizesBytes[uiMount.component] = bundled.byteLength;

      if (runSmoke) {
        const smokeDiagnostics = await runHeadlessUiSmokeCheck({
          limbId: manifest.limb.id,
          slotId: uiMount.slot,
          compiledHtml: bundled.html,
        });
        diagnostics.push(...smokeDiagnostics);
      }
    }
  }

  // Stage 6: Deterministic Egress Diff Gate (`NEWT-CONSENT-001`)
  const approvedSet = new Set(
    (options.approvedEgressHosts ?? []).map((h) => h.toLowerCase())
  );
  const unapprovedEgressHosts = manifest.permissions.egress.filter(
    (h) => !approvedSet.has(h.toLowerCase())
  );
  const requiresEgressConsent = unapprovedEgressHosts.length > 0;

  if (requiresEgressConsent) {
    diagnostics.push({
      code: "NEWT-CONSENT-001",
      severity: "info",
      path: "permissions.egress",
      message: `Human consent required before binding external egress host(s): ${unapprovedEgressHosts.join(", ")}`,
      hint: "Prompt the user with the non-LLM Permission Approval Banner before calling Salamanda setBindings.",
    });
  }

  const valid = !diagnostics.some((d) => d.severity === "error");

  return {
    valid,
    limbId: manifest.limb.id,
    manifest,
    manifestToml,
    assets,
    functions: fnRes.descriptors,
    diagnostics,
    requiresEgressConsent,
    unapprovedEgressHosts,
    bundleSizesBytes,
  };
}
