import os from "node:os";
import path from "node:path";
import {
  type AgentTurnEvent,
  type LlmProvider,
  type OrchestratorResult,
  runNewtOrchestrator,
} from "@newt/agents";
import type { BasePack } from "@newt/base-sdk";
import { type CompiledLimbBundle, compileLimbVfs, type NewtVfs } from "@newt/compiler";
import { serializeLimbManifestToml } from "@newt/contract";
import {
  type MessageRecord,
  NewtDatabase,
  type ProjectMode,
  type ProjectRecord,
  type VfsFileDiff,
  type VfsSnapshotRecord,
} from "@newt/db";
import { BaseRegistry } from "./base-registry";
import { resolveStudioLlmProvider } from "./studio-provider";

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
  mode: ProjectMode;
  basePack: BasePack<Record<string, Array<Record<string, unknown>>>>;
  slotId?: string;
}): NewtVfs {
  const defaultSlot =
    params.slotId ??
    (params.mode === "standalone-ui"
      ? params.basePack.manifest.slots[0]?.id ?? "standalone.canvas"
      : params.basePack.manifest.slots.find((s) => s.id === "blog.sidebar")?.id ??
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
      author: "uid:studio",
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

export class StudioDaemon {
  readonly db: NewtDatabase;
  readonly bases: BaseRegistry;
  readonly dbPath: string;
  private readonly overrideProvider?: LlmProvider;

  constructor(options: StudioDaemonOptions = {}) {
    this.dbPath =
      options.dbPath ??
      process.env.NEWT_DB_PATH ??
      path.join(os.homedir(), ".newt", "studio.sqlite");
    this.db = this.dbPath === ":memory:" ? NewtDatabase.openInMemory() : NewtDatabase.open(this.dbPath);
    this.bases = new BaseRegistry();
    this.overrideProvider = options.provider;
  }

  private getProvider(): { provider: LlmProvider; mode: "live" | "studio-local" | "custom" } {
    if (this.overrideProvider) {
      return { provider: this.overrideProvider, mode: "custom" };
    }
    return resolveStudioLlmProvider((baseId) => this.bases.get(baseId)?.manifest ?? null);
  }

  health() {
    const resolved = this.getProvider();
    return {
      ok: true,
      service: "newt-studio-daemon",
      version: "0.1.0",
      provider: {
        name: resolved.provider.providerName,
        model: resolved.provider.modelName,
        mode: resolved.mode,
      },
      bases: this.bases.list().map((b) => b.id),
      l3Enabled: process.env.NEWT_ENABLE_L3_VARIANTS === "1",
    };
  }

  listProjects(ownerUid: string): ProjectRecord[] {
    return this.db.listProjectsByOwner(ownerUid);
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
    const baseTarget =
      params.baseTarget ?? (params.mode === "standalone-ui" ? "standalone" : "xkmato");
    const basePack = this.bases.get(baseTarget);
    if (!basePack) {
      throw new Error(`Unknown base target '${baseTarget}'`);
    }

    const baseLimbId = sanitizeLimbId(params.limbId ?? params.name);
    const existing = this.db.getProjectByLimbId(baseLimbId);
    const limbId = existing ? `${baseLimbId}-${Date.now().toString(36).slice(-4)}` : baseLimbId;

    const files =
      params.initialFiles ??
      createStarterVfs({
        limbId,
        name: params.name,
        mode: params.mode,
        basePack,
        slotId: params.slotId,
      });

    const compiled = await compileLimbVfs(files, {
      platformManifest: basePack.manifest,
      baseSpec: basePack.baseSpec,
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

    const compiled = await compileLimbVfs(nextFiles, {
      platformManifest: basePack.manifest,
      baseSpec: basePack.baseSpec,
      approvedEgressHosts: params.approvedEgressHosts,
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
    const basePack = this.bases.get(project.baseTarget);
    if (!basePack) {
      throw new Error(`Base target '${project.baseTarget}' is not registered`);
    }

    let threads = this.db.listThreadsForProject(project.id);
    const thread = threads[0] ?? this.db.createThread(project.id);

    this.db.appendMessage({
      threadId: thread.id,
      role: "user",
      content: { prompt: params.prompt, selectedSlot: params.selectedSlot },
    });

    const current = this.db.getCurrentSnapshot(project.id);
    const { provider } = this.getProvider();

    const result = await runNewtOrchestrator({
      prompt: params.prompt,
      authorUid: params.authorUid ?? project.ownerUid,
      platformManifest: basePack.manifest,
      baseSpec: basePack.baseSpec,
      provider,
      existingVfs: current?.files,
      selectedSlot: params.selectedSlot,
      approvedEgressHosts: params.approvedEgressHosts,
      enableL3: process.env.NEWT_ENABLE_L3_VARIANTS === "1",
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
