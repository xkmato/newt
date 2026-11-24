import { compileLimbVfs, type NewtVfs } from "@newt/compiler";
import { serializeLimbManifestToml } from "@newt/contract";
import { evaluateBlueprintPolicy, evaluatePromptSafety } from "./gatekeeper.js";
import {
  buildArchitectPrompts,
  buildDataAndFunctionsPrompts,
  buildRepairPrompts,
  buildUiCraftsmanPrompts,
} from "./prompts.js";
import {
  type AgentTurnEvent,
  FileSynthesisBatchSchema,
  type LimbBlueprint,
  LimbBlueprintSchema,
  type LlmUsage,
  type OrchestratorRequest,
  type OrchestratorResult,
  RepairPatchBatchSchema,
} from "./types.js";

function synthesizeFallbackLimbToml(
  blueprint: LimbBlueprint,
  authorUid: string,
  baseId: string
): string {
  return serializeLimbManifestToml({
    limb: {
      id: blueprint.limbId,
      name: blueprint.displayName,
      version: "0.1.0",
      level: blueprint.level,
      author: authorUid,
      description: blueprint.description,
    },
    requires: {
      contract: ">=1.0",
      base: baseId,
      slots: blueprint.uiMounts.map((u) => u.slot),
    },
    ui: blueprint.uiMounts.map((u) => ({
      slot: u.slot,
      route_pattern: u.routePattern,
      component: u.compiledAsset,
      isolation: u.isolation,
    })),
    functions: blueprint.functions.map((f) => ({
      route: f.route,
      method: f.method,
      handler: f.sourceFile.replace(/^src\//, ""),
    })),
    permissions: {
      data_read: blueprint.permissions.dataRead,
      data_write: [],
      egress: blueprint.permissions.egress,
      sidecar: blueprint.sidecar.scope,
      max_memory_mb: blueprint.permissions.maxMemoryMb,
      max_cpu_ms: blueprint.permissions.maxCpuMs,
    },
    ...(blueprint.sidecar.scope !== "none" ? { sidecar: { migrations: "migrations/" } } : {}),
  });
}

/**
 * Deterministic Multi-Agent State Machine:
 * `Gatekeeper -> ArchitectAgent -> Parallel(DataAndFunctionsAgent, UiCraftsmanAgent) -> 6-Stage Compiler -> Bounded RepairAgent (max 3)`.
 */
export async function runNewtOrchestrator(
  req: OrchestratorRequest
): Promise<OrchestratorResult> {
  const events: AgentTurnEvent[] = [];
  const calls: LlmUsage[] = [];
  const emit = (ev: AgentTurnEvent) => {
    events.push(ev);
    req.onEvent?.(ev);
  };
  const recordUsage = (u: LlmUsage) => calls.push(u);
  const summarizeUsage = () => ({
    inputTokens: calls.reduce((acc, c) => acc + c.inputTokens, 0),
    outputTokens: calls.reduce((acc, c) => acc + c.outputTokens, 0),
    calls,
  });

  const vfs: NewtVfs = { ...(req.existingVfs ?? {}) };

  // 1. Prompt-Injection & Policy Gatekeeper
  const gate = evaluatePromptSafety(req.prompt, req.platformManifest);
  if (!gate.allowed) {
    emit({
      type: "gatekeeper.blocked",
      code: gate.code ?? "NEWT-GATE-001",
      reason: gate.reason ?? "Blocked by security gatekeeper",
    });
    return {
      ok: false,
      status: "blocked",
      blockReason: gate.reason,
      vfs,
      repairAttempts: 0,
      totalUsage: summarizeUsage(),
      events,
    };
  }
  emit({ type: "gatekeeper.passed", sanitizedPrompt: gate.sanitizedPrompt });

  try {
    // 2. ArchitectAgent
    const archPrompts = buildArchitectPrompts({
      sanitizedPrompt: gate.sanitizedPrompt,
      platformManifest: req.platformManifest,
      selectedSlot: req.selectedSlot,
      existingFiles: Object.keys(vfs),
      enableL3: req.enableL3,
    });
    const archRes = await req.provider.generateJson({
      role: "architect",
      ...archPrompts,
    });
    recordUsage(archRes.usage);

    const blueprint = LimbBlueprintSchema.parse(archRes.data);
    const bpPolicy = evaluateBlueprintPolicy(blueprint, req.platformManifest, {
      enableL3: req.enableL3,
    });
    if (!bpPolicy.allowed) {
      emit({
        type: "gatekeeper.blocked",
        code: bpPolicy.code ?? "NEWT-GATE-006",
        reason: bpPolicy.reason ?? "Blueprint policy violation",
      });
      return {
        ok: false,
        status: "blocked",
        blockReason: bpPolicy.reason,
        blueprint,
        vfs,
        repairAttempts: 0,
        totalUsage: summarizeUsage(),
        events,
      };
    }
    emit({ type: "blueprint.ready", blueprint });

    // 3. Parallel Synthesis Fan-Out (`DataAndFunctionsAgent` + `UiCraftsmanAgent`)
    const needsDataAgent =
      blueprint.mode === "salamanda-limb" ||
      blueprint.sidecar.scope !== "none" ||
      blueprint.functions.length > 0;

    emit({
      type: "synthesis.started",
      agents: needsDataAgent ? ["data-functions", "ui-craftsman"] : ["ui-craftsman"],
    });

    const uiPromise = req.provider
      .generateJson({
        role: "ui-craftsman",
        ...buildUiCraftsmanPrompts({
          blueprint,
          platformManifest: req.platformManifest,
          existingVfs: vfs,
        }),
      })
      .then((res) => {
        recordUsage(res.usage);
        return FileSynthesisBatchSchema.parse(res.data);
      });

    const dataPromise = needsDataAgent
      ? req.provider
          .generateJson({
            role: "data-functions",
            ...buildDataAndFunctionsPrompts({
              blueprint,
              authorUid: req.authorUid,
              platformManifest: req.platformManifest,
            }),
          })
          .then((res) => {
            recordUsage(res.usage);
            return FileSynthesisBatchSchema.parse(res.data);
          })
      : Promise.resolve(null);

    const [dataBatch, uiBatch] = await Promise.all([dataPromise, uiPromise]);

    const writtenPaths: string[] = [];
    let wroteLimbToml = false;
    if (dataBatch) {
      for (const f of dataBatch.files) {
        vfs[f.path] = f.content;
        writtenPaths.push(f.path);
        if (f.path === "limb.toml") wroteLimbToml = true;
      }
    }
    if (!wroteLimbToml) {
      vfs["limb.toml"] = synthesizeFallbackLimbToml(
        blueprint,
        req.authorUid,
        req.platformManifest.base.id
      );
      writtenPaths.push("limb.toml");
    }
    for (const f of uiBatch.files) {
      vfs[f.path] = f.content;
      writtenPaths.push(f.path);
    }

    emit({
      type: "vfs.updated",
      paths: Array.from(new Set(writtenPaths)),
      summary: uiBatch.summary,
    });

    // 4. Deterministic 6-Stage Compiler Verification
    const compileOnce = () =>
      compileLimbVfs(vfs, {
        platformManifest: req.platformManifest,
        baseSpec: req.baseSpec,
        isSharedPublication: req.isSharedPublication ?? false,
        approvedEgressHosts: req.approvedEgressHosts,
        runSmokeTest: req.runSmokeTest ?? true,
      });

    let compiled = await compileOnce();
    emit({
      type: "compile.result",
      valid: compiled.valid,
      diagnostics: compiled.diagnostics,
    });

    // 5. Bounded Self-Correction Loop (`RepairAgent`, max 3 retries)
    const maxAttempts = req.maxRepairAttempts ?? 3;
    let repairAttempts = 0;

    while (!compiled.valid && repairAttempts < maxAttempts) {
      repairAttempts += 1;
      const errorDiagnostics = compiled.diagnostics.filter((d) => d.severity === "error");
      emit({
        type: "repair.attempt",
        attempt: repairAttempts,
        maxAttempts,
        errorCount: errorDiagnostics.length,
      });

      const repairRes = await req.provider.generateJson({
        role: "repair",
        ...buildRepairPrompts({
          blueprint,
          vfs,
          diagnostics: errorDiagnostics,
          platformManifest: req.platformManifest,
        }),
      });
      recordUsage(repairRes.usage);

      const patchBatch = RepairPatchBatchSchema.parse(repairRes.data);
      const editedPaths: string[] = [];
      for (const edit of patchBatch.edits) {
        vfs[edit.path] = edit.content;
        editedPaths.push(edit.path);
      }
      emit({
        type: "vfs.updated",
        paths: editedPaths,
        summary: `Repair #${repairAttempts}: ${patchBatch.diagnosis}`,
      });

      compiled = await compileOnce();
      emit({
        type: "compile.result",
        valid: compiled.valid,
        diagnostics: compiled.diagnostics,
      });
    }

    emit({
      type: "turn.complete",
      valid: compiled.valid,
      repairAttempts,
      requiresEgressConsent: compiled.requiresEgressConsent,
    });

    return {
      ok: compiled.valid,
      status: compiled.valid ? "ready" : "repair_exhausted",
      blueprint,
      vfs,
      compiled,
      repairAttempts,
      totalUsage: summarizeUsage(),
      events,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit({ type: "turn.error", message });
    return {
      ok: false,
      status: "error",
      blockReason: message,
      vfs,
      repairAttempts: 0,
      totalUsage: summarizeUsage(),
      events,
    };
  }
}
