import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  computePatchSha256Digest,
  enforceVariantEditPolicy,
  extractTouchedPathsFromUnifiedDiff,
} from "@newt/compiler";
import type { BaseSpec, Diagnostic } from "@newt/contract";

export type VariantLifecycleStage =
  | "Defined"
  | "Materializing"
  | "Building"
  | "Starting"
  | "Running"
  | "Hibernated"
  | "Rebasing"
  | "Stale"
  | "Failed";

export interface VariantProgressEvent {
  stage: VariantLifecycleStage;
  variantId?: string;
  message: string;
  timestamp: number;
  port?: number;
  cacheHit?: boolean;
  conflictReason?: string;
  fallbackToVanilla?: boolean;
}

export interface ManagedVariantRecord {
  projectId: string;
  variantId: string;
  baseRepoDir: string;
  baseCommit: string;
  patchDiff: string;
  patchDigest: string;
  touches: string[];
  worktreePath: string;
  state: VariantLifecycleStage;
  port: number | null;
  fallbackToVanilla: boolean;
  conflictReason: string | null;
  upstreamFiles: Record<string, string>;
  metrics: {
    worktreeMaterializeMs: number;
    patchApplyMs: number;
    cacheHit: boolean;
  };
  history: VariantProgressEvent[];
}

export class VariantPolicyError extends Error {
  readonly diagnostics: Diagnostic[];

  constructor(diagnostics: Diagnostic[]) {
    super(diagnostics.map((d) => `[${d.code}] ${d.message}`).join("; "));
    this.name = "VariantPolicyError";
    this.diagnostics = diagnostics;
  }
}

export function computeVariantId(baseCommit: string, limbDigests: string[]): string {
  const hash = crypto.createHash("sha256");
  hash.update(baseCommit);
  for (const d of limbDigests) {
    hash.update(":");
    hash.update(d);
  }
  return `v_${hash.digest("hex").slice(0, 12)}`;
}

function runGit(cwd: string, args: string[]): { ok: boolean; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, stdout: stdout.trim(), stderr: "" };
  } catch (err) {
    const e = err as { stdout?: Buffer | string; stderr?: Buffer | string; message?: string };
    return {
      ok: false,
      stdout: e.stdout ? String(e.stdout).trim() : "",
      stderr: e.stderr ? String(e.stderr).trim() : (e.message ?? "git command failed"),
    };
  }
}

/**
 * TypeScript Level 3 Variant Materializer mirroring `salamanda-variants`:
 * - Enforces pre-flight `SAL-EDIT-001` (`edit_allow` / `edit_deny`) before worktree creation
 * - Materializes isolated copy-on-write Git worktrees + applies unified diffs
 * - Content-addressed build cache (`variantId = v_<sha256(baseCommit:patchDigest)[..12]>`)
 * - Rebases active variants onto new upstream Base commits, transitioning to `Stale`
 *   with `fallbackToVanilla = true` and captured upstream file contents on conflict.
 */
export class VariantManager {
  private readonly byProject = new Map<string, ManagedVariantRecord>();
  private readonly byVariantId = new Map<string, ManagedVariantRecord>();
  private readonly worktreesRoot: string;
  private nextPort = 4600;

  constructor(worktreesRoot?: string) {
    this.worktreesRoot =
      worktreesRoot ?? path.join(os.tmpdir(), `newt-l3-worktrees-${process.pid}`);
    fs.mkdirSync(this.worktreesRoot, { recursive: true });
  }

  getForProject(projectId: string): ManagedVariantRecord | null {
    return this.byProject.get(projectId) ?? null;
  }

  readBaseFiles(baseRepoDir: string, relPaths: string[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (const rel of relPaths) {
      const full = path.join(baseRepoDir, rel);
      if (fs.existsSync(full) && fs.statSync(full).isFile()) {
        out[rel] = fs.readFileSync(full, "utf8");
      }
    }
    return out;
  }

  async materialize(params: {
    projectId: string;
    baseRepoDir: string;
    baseSpec: BaseSpec;
    patchDiff: string;
    onProgress?: (ev: VariantProgressEvent) => void;
  }): Promise<ManagedVariantRecord> {
    const history: VariantProgressEvent[] = [];
    const emit = (
      stage: VariantLifecycleStage,
      message: string,
      extra?: Partial<VariantProgressEvent>
    ) => {
      const ev: VariantProgressEvent = {
        stage,
        message,
        timestamp: Date.now(),
        ...extra,
      };
      history.push(ev);
      params.onProgress?.(ev);
    };

    const touches = extractTouchedPathsFromUnifiedDiff(params.patchDiff);
    const policyDiagnostics = enforceVariantEditPolicy(touches, params.baseSpec);
    if (policyDiagnostics.length > 0) {
      emit("Failed", policyDiagnostics[0]!.message);
      throw new VariantPolicyError(policyDiagnostics);
    }

    const headRes = runGit(params.baseRepoDir, ["rev-parse", "HEAD"]);
    if (!headRes.ok) {
      emit("Failed", `Base repo is not a valid Git repository: ${headRes.stderr}`);
      throw new Error(`Base repo Git error: ${headRes.stderr}`);
    }
    const baseCommit = headRes.stdout;
    const patchDigest = computePatchSha256Digest(params.patchDiff);
    const variantId = computeVariantId(baseCommit, [patchDigest]);

    // Content-addressed build cache hit
    const cached = this.byVariantId.get(variantId);
    if (cached && cached.state === "Running" && fs.existsSync(cached.worktreePath)) {
      emit("Materializing", `Cache hit for content-addressed variant ${variantId}`, {
        variantId,
        cacheHit: true,
      });
      emit("Running", `Reused running variant ${variantId} on port ${cached.port}`, {
        variantId,
        port: cached.port ?? undefined,
        cacheHit: true,
      });
      const reused: ManagedVariantRecord = {
        ...cached,
        projectId: params.projectId,
        metrics: { worktreeMaterializeMs: 0, patchApplyMs: 0, cacheHit: true },
        history,
      };
      this.byProject.set(params.projectId, reused);
      return reused;
    }

    // 1. Materializing
    emit("Materializing", `Creating copy-on-write Git worktree for ${variantId} @ ${baseCommit.slice(0, 8)}`, {
      variantId,
      cacheHit: false,
    });
    const wtDir = path.join(this.worktreesRoot, `${variantId}-${Date.now().toString(36)}`);
    const t0 = Date.now();
    const wtRes = runGit(params.baseRepoDir, ["worktree", "add", "--detach", wtDir, baseCommit]);
    if (!wtRes.ok) {
      emit("Failed", `git worktree add failed: ${wtRes.stderr}`, { variantId });
      throw new Error(`git worktree add failed: ${wtRes.stderr}`);
    }
    const worktreeMaterializeMs = Date.now() - t0;

    // 2. Apply unified diff patch
    const t1 = Date.now();
    const tmpPatch = path.join(wtDir, ".newt_variant.patch");
    fs.writeFileSync(tmpPatch, params.patchDiff, "utf8");
    const applyRes = runGit(wtDir, ["apply", ".newt_variant.patch"]);
    fs.rmSync(tmpPatch, { force: true });
    const patchApplyMs = Date.now() - t1;

    if (!applyRes.ok) {
      emit("Stale", `Patch failed to apply cleanly: ${applyRes.stderr}`, {
        variantId,
        conflictReason: applyRes.stderr,
        fallbackToVanilla: true,
      });
      const staleRecord: ManagedVariantRecord = {
        projectId: params.projectId,
        variantId,
        baseRepoDir: params.baseRepoDir,
        baseCommit,
        patchDiff: params.patchDiff,
        patchDigest,
        touches,
        worktreePath: wtDir,
        state: "Stale",
        port: null,
        fallbackToVanilla: true,
        conflictReason: applyRes.stderr,
        upstreamFiles: this.readBaseFiles(params.baseRepoDir, touches),
        metrics: { worktreeMaterializeMs, patchApplyMs, cacheHit: false },
        history,
      };
      this.byProject.set(params.projectId, staleRecord);
      return staleRecord;
    }

    // 3. Building -> Starting -> Running
    emit("Building", `Patched ${touches.join(", ")} (${patchApplyMs}ms); preparing variant runtime`, {
      variantId,
    });
    emit("Starting", `Allocating isolated runtime port for ${variantId}`, { variantId });

    const port = this.nextPort++;
    emit("Running", `Variant ${variantId} running on port ${port}`, {
      variantId,
      port,
      cacheHit: false,
      fallbackToVanilla: false,
    });

    const record: ManagedVariantRecord = {
      projectId: params.projectId,
      variantId,
      baseRepoDir: params.baseRepoDir,
      baseCommit,
      patchDiff: params.patchDiff,
      patchDigest,
      touches,
      worktreePath: wtDir,
      state: "Running",
      port,
      fallbackToVanilla: false,
      conflictReason: null,
      upstreamFiles: {},
      metrics: { worktreeMaterializeMs, patchApplyMs, cacheHit: false },
      history,
    };

    this.byProject.set(params.projectId, record);
    this.byVariantId.set(variantId, record);
    return record;
  }

  rebaseOntoCommit(params: {
    projectId: string;
    newCommit?: string;
  }): ManagedVariantRecord {
    const existing = this.byProject.get(params.projectId);
    if (!existing) {
      throw new Error(`No materialized Level 3 variant found for project '${params.projectId}'`);
    }

    const targetRef = params.newCommit ?? "HEAD";
    const resolved = runGit(existing.baseRepoDir, ["rev-parse", targetRef]);
    const newSha = resolved.ok ? resolved.stdout : targetRef;

    const history = [...existing.history];
    history.push({
      stage: "Rebasing",
      variantId: existing.variantId,
      message: `Rebasing variant ${existing.variantId} onto upstream commit ${newSha.slice(0, 8)}`,
      timestamp: Date.now(),
    });

    const checkoutRes = runGit(existing.worktreePath, ["checkout", "-f", newSha]);
    if (!checkoutRes.ok) {
      const failed: ManagedVariantRecord = {
        ...existing,
        state: "Failed",
        fallbackToVanilla: true,
        conflictReason: checkoutRes.stderr,
        history: [
          ...history,
          {
            stage: "Failed",
            variantId: existing.variantId,
            message: `git checkout failed: ${checkoutRes.stderr}`,
            timestamp: Date.now(),
            fallbackToVanilla: true,
          },
        ],
      };
      this.byProject.set(params.projectId, failed);
      return failed;
    }

    const tmpPatch = path.join(existing.worktreePath, ".newt_rebase.patch");
    fs.writeFileSync(tmpPatch, existing.patchDiff, "utf8");
    const applyRes = runGit(existing.worktreePath, ["apply", ".newt_rebase.patch"]);
    fs.rmSync(tmpPatch, { force: true });

    if (!applyRes.ok) {
      const upstreamFiles = this.readBaseFiles(existing.baseRepoDir, existing.touches);
      const stale: ManagedVariantRecord = {
        ...existing,
        baseCommit: newSha,
        state: "Stale",
        port: null,
        fallbackToVanilla: true,
        conflictReason: applyRes.stderr,
        upstreamFiles,
        history: [
          ...history,
          {
            stage: "Stale",
            variantId: existing.variantId,
            message: `Rebase conflict on ${newSha.slice(0, 8)} — safely falling back to Vanilla Base`,
            timestamp: Date.now(),
            conflictReason: applyRes.stderr,
            fallbackToVanilla: true,
          },
        ],
      };
      this.byProject.set(params.projectId, stale);
      return stale;
    }

    const port = this.nextPort++;
    const clean: ManagedVariantRecord = {
      ...existing,
      baseCommit: newSha,
      state: "Running",
      port,
      fallbackToVanilla: false,
      conflictReason: null,
      upstreamFiles: {},
      history: [
        ...history,
        {
          stage: "Running",
          variantId: existing.variantId,
          message: `Rebase succeeded cleanly onto ${newSha.slice(0, 8)} (port ${port})`,
          timestamp: Date.now(),
          port,
          fallbackToVanilla: false,
        },
      ],
    };
    this.byProject.set(params.projectId, clean);
    this.byVariantId.set(existing.variantId, clean);
    return clean;
  }

  cleanupAll(): void {
    for (const rec of this.byProject.values()) {
      try {
        runGit(rec.baseRepoDir, ["worktree", "remove", "--force", rec.worktreePath]);
      } catch {
        // ignore
      }
      fs.rmSync(rec.worktreePath, { recursive: true, force: true });
    }
    this.byProject.clear();
    this.byVariantId.clear();
  }
}
