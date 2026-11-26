import {
  type AgentTurnEvent,
  type LlmProvider,
  type OrchestratorResult,
  type RebaseConflictContext,
  runNewtOrchestrator,
} from "@newt/agents";
import type { BasePack } from "@newt/base-sdk";
import { type CompiledLimbBundle, compileLimbVfs, type NewtVfs } from "@newt/compiler";
import {
  namespaceLimbId,
  SalamandaControlPlaneClient,
  serializeLimbManifestToml,
} from "@newt/contract";
import {
  type MessageRecord,
  NewtDatabase,
  type ProjectMode,
  type ProjectRecord,
  type VfsFileDiff,
  type VfsSnapshotRecord,
} from "@newt/db";
import { getSalamandaConfigFromEnv } from "./auth";
import { BaseRegistry } from "./base-registry";
import {
  getEnabledFeatures,
  isFeatureEnabled,
  isLocalEnv,
  resolveStudioDbPath,
} from "./config";
import { resolveStudioLlmProvider } from "./studio-provider";
import { VariantManager } from "./variant-manager";

function sanitizeLimbId(raw: string): string {
  const clean = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56);
  return clean.length >= 3 ? clean : `limb-${Date.now().toString(36)}`;
}

export function createStarterVfs(params: {
  limbId: string;
  name: string;
  ownerUid?: string;
  mode: ProjectMode;
  basePack: BasePack<Record<string, Array<Record<string, unknown>>>>;
  slotId?: string;
}): NewtVfs {
  const defaultSlot =
    params.slotId ??
    (params.mode === "standalone-ui"
      ? params.basePack.manifest.slots[0]?.id ?? "standalone.canvas"
      : params.basePack.manifest.slots.find((s) => s.id === "article.footer")?.id ??
        params.basePack.manifest.slots.find((s) => s.id === "article.sidebar")?.id ??
        params.basePack.manifest.slots.find((s) => s.id === "blog.sidebar")?.id ??
        params.basePack.manifest.slots[0]?.id ??
        "blog.sidebar");

  const slotSpec = params.basePack.manifest.slots.find((s) => s.id === defaultSlot);
  const routePattern = slotSpec?.routes[0] ?? "/*";

  const limbToml = serializeLimbManifestToml({
    limb: {
      id: params.limbId,
      name: params.name,
      version: "0.1.0",
      level: 1,
      author: params.ownerUid ?? "uid:studio",
      description: `Starter ${params.mode} project for ${params.basePack.manifest.base.name}`,
    },
    requires: {
      contract: ">=1.0",
      base: params.basePack.manifest.base.id,
      slots: [defaultSlot],
    },
    ui: [
      {
        slot: defaultSlot,
        route_pattern: routePattern,
        component: "ui/App.html",
        isolation: "iframe",
      },
    ],
    permissions: {
      data_read: [],
      data_write: [],
      egress: [],
      sidecar: "none",
      max_memory_mb: 64,
      max_cpu_ms: 400,
    },
  });

  const tsx = `import { useSlotContext } from "@newt/ui-sdk";

export default function StarterLimb() {
  const ctx = useSlotContext();
  return (
    <section
      style={{
        background: "var(--newt-card)",
        color: "var(--newt-fg)",
        border: "1px dashed var(--newt-border)",
        borderRadius: "var(--newt-radius)",
        padding: "14px",
        fontSize: "13px",
      }}
    >
      <strong style={{ display: "block", marginBottom: "4px" }}>${params.name}</strong>
      <span style={{ color: "var(--newt-muted)" }}>
        Ready in slot <code>{ctx.slotId}</code> ({ctx.theme} mode). Prompt the Newt Agent to build this Limb.
      </span>
    </section>
  );
}
`;

  return {
    "limb.toml": limbToml,
    "src/ui/App.tsx": tsx,
  };
}

export interface StudioDaemonOptions {
  dbPath?: string;
  provider?: LlmProvider;
}

const CAPABILITIES_CACHE_TTL_MS = 15_000;

export class StudioDaemon {
  readonly db: NewtDatabase;
  readonly bases: BaseRegistry;
  readonly variants: VariantManager;
  readonly dbPath: string;
  private readonly overrideProvider?: LlmProvider;
  private cachedL2JsRuntime: { value: boolean; expiresAt: number; url: string } | null = null;

  constructor(options: StudioDaemonOptions = {}) {
    this.dbPath = resolveStudioDbPath(options.dbPath);
    this.db =
      this.dbPath === ":memory:" ? NewtDatabase.openInMemory() : NewtDatabase.open(this.dbPath);
    this.bases = new BaseRegistry();
    this.variants = new VariantManager();
    this.overrideProvider = options.provider;
    // Kick off non-blocking manifest sync if NEWT_BASE_URL is configured (falls back gracefully if offline)
    if (process.env.NEWT_BASE_URL?.trim()) {
      void this.bases.syncFromBaseUrl();
    }
  }

  private getProvider(): { provider: LlmProvider; mode: "live" | "studio-local" | "custom" } {
    if (this.overrideProvider) {
      return { provider: this.overrideProvider, mode: "custom" };
    }
    return resolveStudioLlmProvider((baseId) => this.bases.get(baseId)?.manifest ?? null);
  }

  /**
   * Checks Salamanda `GET /v1/capabilities` for `features.l2_js_runtime`
   * (cached for 15s, fail-open to `false` so v1.0 `// @host:` DSL remains the safe default).
   */
  async resolveL2JsRuntimeCapability(): Promise<boolean> {
    const cfg = getSalamandaConfigFromEnv();
    if (
      this.cachedL2JsRuntime &&
      this.cachedL2JsRuntime.url === cfg.controlPlaneUrl &&
      Date.now() < this.cachedL2JsRuntime.expiresAt
    ) {
      return this.cachedL2JsRuntime.value;
    }

    // Avoid external network calls during unit tests unless SALAMANDA_CONTROL_PLANE_URL is explicitly configured
    if (process.env.VITEST && !process.env.SALAMANDA_CONTROL_PLANE_URL) {
      return false;
    }

    try {
      const client = new SalamandaControlPlaneClient(cfg);
      const caps = await client.getCapabilities();
      const flag = caps.features?.l2_js_runtime;
      const enabled = Boolean(flag && flag !== "disabled");
      this.cachedL2JsRuntime = {
        value: enabled,
        expiresAt: Date.now() + CAPABILITIES_CACHE_TTL_MS,
        url: cfg.controlPlaneUrl,
      };
      return enabled;
    } catch {
      this.cachedL2JsRuntime = {
        value: false,
        expiresAt: Date.now() + 5_000,
        url: cfg.controlPlaneUrl,
      };
      return false;
    }
  }

  health() {
    const resolved = this.getProvider();
    const features = getEnabledFeatures();
    return {
      ok: true,
      service: "newt-studio-daemon",
      version: "0.1.0",
      env: isLocalEnv() ? "local" : "production",
      provider: {
        name: resolved.provider.providerName,
        model: resolved.provider.modelName,
        mode: resolved.mode,
      },
      bases: this.bases.list().map((b) => b.id),
      defaultBase: process.env.NEWT_BASE_URL?.trim() ? "blog" : "xkmato",
      features,
      l3Enabled: features.l3,
    };
  }

  listProjects(ownerUid?: string): ProjectRecord[] {
    return this.db.listProjects(ownerUid);
  }

  async createProject(params: {
    ownerUid: string;
    name: string;
    mode: ProjectMode;
    baseTarget?: string;
    limbId?: string;
    slotId?: string;
    initialFiles?: NewtVfs;
  }): Promise<{
    project: ProjectRecord;
    snapshot: VfsSnapshotRecord;
    compiled: CompiledLimbBundle;
  }> {
    await this.bases.ensureBaseSynced();

    const defaultTarget =
      params.mode === "standalone-ui"
        ? "standalone"
        : process.env.NEWT_BASE_URL?.trim()
          ? "blog"
          : "xkmato";
    const baseTarget = params.baseTarget ?? defaultTarget;
    const basePack = this.bases.get(baseTarget);
    if (!basePack) {
      throw new Error(`Unknown base target '${baseTarget}'`);
    }

    const baseLimbId = params.limbId
      ? sanitizeLimbId(params.limbId)
      : namespaceLimbId(params.ownerUid, params.name);
    const existing = this.db.getProjectByLimbId(baseLimbId);
    const limbId = existing
      ? `${baseLimbId.slice(0, 58)}-${Date.now().toString(36).slice(-4)}`
      : baseLimbId;

    const files =
      params.initialFiles ??
      createStarterVfs({
        limbId,
        name: params.name,
        ownerUid: params.ownerUid,
        mode: params.mode,
        basePack,
        slotId: params.slotId,
      });

    const l2JsRuntime = await this.resolveL2JsRuntimeCapability();
    const compiled = await compileLimbVfs(files, {
      platformManifest: basePack.manifest,
      baseSpec: basePack.baseSpec,
      l2JsRuntime,
      runSmokeTest: true,
    });

    const project = this.db.createProject({
      ownerUid: params.ownerUid,
      limbId,
      name: params.name,
      mode: params.mode,
      baseTarget,
    });

    const snapshot = this.db.saveSnapshot({
      projectId: project.id,
      files,
      compiledBundle: compiled,
      summary: "Initial project scaffold",
    });

    this.db.createThread(project.id);

    return {
      project: this.db.getProject(project.id)!,
      snapshot,
      compiled,
    };
  }

  getProjectDetail(projectId: string): {
    project: ProjectRecord;
    currentSnapshot: VfsSnapshotRecord | null;
    snapshots: VfsSnapshotRecord[];
    diff: VfsFileDiff[];
    messages: MessageRecord[];
  } | null {
    const project = this.db.getProject(projectId);
    if (!project) return null;
    const currentSnapshot = this.db.getCurrentSnapshot(projectId);
    const snapshots = this.db.listSnapshots(projectId);
    let diff: VfsFileDiff[] = [];
    if (currentSnapshot && currentSnapshot.parentSnapshotId !== null) {
      try {
        diff = this.db.diffSnapshots(currentSnapshot.parentSnapshotId, currentSnapshot.id);
      } catch {
        diff = [];
      }
    }
    const threads = this.db.listThreadsForProject(projectId);
    const messages = threads[0] ? this.db.listMessages(threads[0].id) : [];

    return {
      project,
      currentSnapshot,
      snapshots,
      diff,
      messages,
    };
  }

  async updateProjectFiles(
    projectId: string,
    params: {
      files?: NewtVfs;
      patch?: Record<string, string | null>;
      summary?: string;
      approvedEgressHosts?: string[];
    }
  ): Promise<{
    project: ProjectRecord;
    snapshot: VfsSnapshotRecord;
    compiled: CompiledLimbBundle;
    diff: VfsFileDiff[];
  }> {
    const project = this.db.getProject(projectId);
    if (!project) {
      throw new Error(`Project '${projectId}' not found`);
    }
    await this.bases.ensureBaseSynced();
    const basePack = this.bases.get(project.baseTarget);
    if (!basePack) {
      throw new Error(`Base target '${project.baseTarget}' is not registered`);
    }

    const current = this.db.getCurrentSnapshot(projectId);
    const nextFiles: NewtVfs = params.files
      ? { ...params.files }
      : { ...(current?.files ?? {}) };

    if (params.patch) {
      for (const [filePath, content] of Object.entries(params.patch)) {
        if (content === null) {
          delete nextFiles[filePath];
        } else {
          nextFiles[filePath] = content;
        }
      }
    }

    const l2JsRuntime = await this.resolveL2JsRuntimeCapability();
    const compiled = await compileLimbVfs(nextFiles, {
      platformManifest: basePack.manifest,
      baseSpec: basePack.baseSpec,
      approvedEgressHosts: params.approvedEgressHosts,
      l2JsRuntime,
      runSmokeTest: true,
    });

    const snapshot = this.db.saveSnapshot({
      projectId,
      files: nextFiles,
      compiledBundle: compiled,
      summary: params.summary ?? "Manual file edit",
    });

    const diff =
      snapshot.parentSnapshotId !== null
        ? this.db.diffSnapshots(snapshot.parentSnapshotId, snapshot.id)
        : [];

    return {
      project: this.db.getProject(projectId)!,
      snapshot,
      compiled,
      diff,
    };
  }

  rollbackProject(
    projectId: string,
    snapshotId: number
  ): {
    project: ProjectRecord;
    snapshot: VfsSnapshotRecord;
    snapshots: VfsSnapshotRecord[];
    diff: VfsFileDiff[];
  } {
    const snapshot = this.db.rollbackProjectToSnapshot(projectId, snapshotId);
    const project = this.db.getProject(projectId)!;
    const snapshots = this.db.listSnapshots(projectId);
    const diff =
      snapshot.parentSnapshotId !== null
        ? this.db.diffSnapshots(snapshot.parentSnapshotId, snapshot.id)
        : [];
    return { project, snapshot, snapshots, diff };
  }

  async runChatTurn(params: {
    projectId: string;
    prompt: string;
    authorUid?: string;
    selectedSlot?: string;
    approvedEgressHosts?: string[];
    enableL3?: boolean;
    baseSourceFiles?: Record<string, string>;
    rebaseConflict?: RebaseConflictContext;
    untrustedHostContext?: string;
    onEvent?: (event: AgentTurnEvent) => void;
  }): Promise<{
    result: OrchestratorResult;
    snapshot: VfsSnapshotRecord | null;
    diff: VfsFileDiff[];
  }> {
    const project = this.db.getProject(params.projectId);
    if (!project) {
      throw new Error(`Project '${params.projectId}' not found`);
    }
    await this.bases.ensureBaseSynced();
    const basePack = this.bases.get(project.baseTarget);
    if (!basePack) {
      throw new Error(`Base target '${project.baseTarget}' is not registered`);
    }

    const threads = this.db.listThreadsForProject(project.id);
    const thread = threads[0] ?? this.db.createThread(project.id);

    this.db.appendMessage({
      threadId: thread.id,
      role: "user",
      content: { prompt: params.prompt, selectedSlot: params.selectedSlot },
    });

    const current = this.db.getCurrentSnapshot(project.id);
    const { provider } = this.getProvider();
    const l3GateOpen = params.enableL3 ?? isFeatureEnabled("l3");
    const l2JsRuntime = await this.resolveL2JsRuntimeCapability();

    // When L3 is enabled and the base supports variants, advertise level 3
    const effectiveManifest =
      l3GateOpen && !basePack.manifest.runtime.allow_levels.includes(3)
        ? {
            ...basePack.manifest,
            runtime: {
              ...basePack.manifest.runtime,
              allow_levels: [...basePack.manifest.runtime.allow_levels, 3] as Array<1 | 2 | 3>,
            },
          }
        : basePack.manifest;
    const effectiveBaseSpec =
      l3GateOpen && !basePack.baseSpec.extensions.allow_levels.includes(3)
        ? {
            ...basePack.baseSpec,
            extensions: {
              ...basePack.baseSpec.extensions,
              allow_levels: [...basePack.baseSpec.extensions.allow_levels, 3] as Array<1 | 2 | 3>,
            },
          }
        : basePack.baseSpec;

    let baseSourceFiles = params.baseSourceFiles;
    if (l3GateOpen && !baseSourceFiles && process.env.NEWT_BASE_REPO_DIR) {
      baseSourceFiles = this.variants.readBaseFiles(process.env.NEWT_BASE_REPO_DIR, [
        "src/app/page.tsx",
        "src/app/layout.tsx",
        "app/page.html",
      ]);
    }

    const result = await runNewtOrchestrator({
      prompt: params.prompt,
      authorUid: params.authorUid ?? project.ownerUid,
      platformManifest: effectiveManifest,
      baseSpec: effectiveBaseSpec,
      provider,
      existingVfs: current?.files,
      selectedSlot: params.selectedSlot,
      approvedEgressHosts: params.approvedEgressHosts,
      enableL3: l3GateOpen,
      baseSourceFiles,
      rebaseConflict: params.rebaseConflict,
      untrustedHostContext: params.untrustedHostContext,
      l2JsRuntime,
      runSmokeTest: true,
      onEvent: params.onEvent,
    });

    let snapshot: VfsSnapshotRecord | null = null;
    let diff: VfsFileDiff[] = [];

    if (result.status !== "blocked" && Object.keys(result.vfs).length > 0) {
      snapshot = this.db.saveSnapshot({
        projectId: project.id,
        files: result.vfs,
        compiledBundle: result.compiled ?? null,
        summary: result.blueprint
          ? `Agent: ${result.blueprint.displayName} (${result.ok ? "valid" : result.status})`
          : `Agent turn (${result.status})`,
      });
      if (snapshot.parentSnapshotId !== null) {
        diff = this.db.diffSnapshots(snapshot.parentSnapshotId, snapshot.id);
      }
    }

    this.db.appendMessage({
      threadId: thread.id,
      role: "assistant",
      content: {
        status: result.status,
        ok: result.ok,
        blockReason: result.blockReason,
        blueprint: result.blueprint,
        repairAttempts: result.repairAttempts,
        totalUsage: result.totalUsage,
        events: result.events,
      },
      snapshotId: snapshot?.id ?? null,
    });

    return { result, snapshot, diff };
  }
}

const globalForDaemon = globalThis as unknown as { __newtStudioDaemon?: StudioDaemon };

export function getStudioDaemon(): StudioDaemon {
  if (!globalForDaemon.__newtStudioDaemon) {
    globalForDaemon.__newtStudioDaemon = new StudioDaemon();
  }
  return globalForDaemon.__newtStudioDaemon;
}

export function setStudioDaemonForTesting(daemon: StudioDaemon | undefined): void {
  globalForDaemon.__newtStudioDaemon = daemon;
}
