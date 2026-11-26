import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { CompiledLimbBundle, NewtVfs } from "@newt/compiler";
import { NEWT_DB_SCHEMA_SQL } from "./schema.js";
import type {
  DeploymentEnvironment,
  DeploymentRecord,
  DeploymentStatus,
  EntitlementGrantRecord,
  EntitlementSource,
  GalleryListingRecord,
  GalleryVisibility,
  MessageRecord,
  MessageRole,
  MonetizationMode,
  ProjectMode,
  ProjectRecord,
  ThreadRecord,
  VfsFileDiff,
  VfsSnapshotRecord,
} from "./types.js";

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(6).toString("hex")}`;
}

function asProject(row: Record<string, unknown>): ProjectRecord {
  return {
    id: String(row.id),
    ownerUid: String(row.owner_uid),
    limbId: String(row.limb_id),
    name: String(row.name),
    mode: row.mode as ProjectMode,
    baseTarget: String(row.base_target),
    currentSnapshotId:
      row.current_snapshot_id === null || row.current_snapshot_id === undefined
        ? null
        : Number(row.current_snapshot_id),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function asSnapshot(row: Record<string, unknown>): VfsSnapshotRecord {
  return {
    id: Number(row.id),
    projectId: String(row.project_id),
    parentSnapshotId:
      row.parent_snapshot_id === null || row.parent_snapshot_id === undefined
        ? null
        : Number(row.parent_snapshot_id),
    files: JSON.parse(String(row.files_json)) as NewtVfs,
    compiledBundle: row.compiled_bundle_json
      ? (JSON.parse(String(row.compiled_bundle_json)) as CompiledLimbBundle)
      : null,
    summary: String(row.summary),
    createdAt: Number(row.created_at),
  };
}

function asGalleryListing(row: Record<string, unknown>): GalleryListingRecord {
  return {
    limbId: String(row.limb_id),
    projectId: String(row.project_id),
    authorUid: String(row.author_uid),
    title: String(row.title),
    description: String(row.description),
    baseTarget: String(row.base_target),
    publishedDigest: String(row.published_digest),
    visibility: row.visibility as GalleryVisibility,
    monetizationMode: row.monetization_mode as MonetizationMode,
    priceLabel: row.price_label ? String(row.price_label) : null,
    permissionsSummary: JSON.parse(String(row.permissions_summary_json)),
    installsCount: Number(row.installs_count),
    publishedAt: Number(row.published_at),
  };
}

/**
 * Zero-ops SQLite WAL persistence layer for Newt Studio, VFS Checkpoints,
 * Multi-Agent Threads, Salamanda Deployments, and Limb Gallery Entitlements.
 */
export class NewtDatabase {
  private readonly db: DatabaseSync;

  private constructor(dbPath: string) {
    if (dbPath !== ":memory:") {
      fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    if (dbPath !== ":memory:") {
      this.db.exec("PRAGMA journal_mode = WAL;");
    }
    this.db.exec("PRAGMA busy_timeout = 5000;");
    this.db.exec(NEWT_DB_SCHEMA_SQL);
    this.runMigrations();
  }

  private runMigrations(): void {
    // Backward-compatible migration: ensure `projects.owner_uid` exists on legacy DBs
    const projectCols = this.db
      .prepare("PRAGMA table_info(projects)")
      .all() as Array<{ name: string }>;
    if (!projectCols.some((c) => c.name === "owner_uid")) {
      this.db.exec("ALTER TABLE projects ADD COLUMN owner_uid TEXT NOT NULL DEFAULT 'uid:studio';");
      this.db.exec(
        "CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_uid, updated_at DESC);"
      );
    }

    // Backward-compatible migration: ensure `deployments` has `idempotency_key`, `error_message`,
    // and supports `status = 'failed'` in CHECK constraint
    const depCols = this.db
      .prepare("PRAGMA table_info(deployments)")
      .all() as Array<{ name: string }>;
    const depSchemaRow = this.db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'deployments'")
      .get() as { sql?: string } | undefined;
    const needsCheckUpgrade = Boolean(depSchemaRow?.sql && !depSchemaRow.sql.includes("'failed'"));

    if (needsCheckUpgrade) {
      this.db.exec(`
        PRAGMA foreign_keys = OFF;
        CREATE TABLE deployments_v2 (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          snapshot_id INTEGER NOT NULL REFERENCES vfs_snapshots(id) ON DELETE CASCADE,
          principal_uid TEXT NOT NULL,
          environment TEXT NOT NULL,
          published_digest TEXT,
          status TEXT NOT NULL CHECK (status IN ('active', 'detached', 'quarantined', 'failed')),
          idempotency_key TEXT,
          error_message TEXT,
          created_at INTEGER NOT NULL
        );
        INSERT INTO deployments_v2 (id, project_id, snapshot_id, principal_uid, environment, published_digest, status, created_at)
        SELECT id, project_id, snapshot_id, principal_uid, environment, published_digest, status, created_at FROM deployments;
        DROP TABLE deployments;
        ALTER TABLE deployments_v2 RENAME TO deployments;
        CREATE INDEX IF NOT EXISTS idx_deployments_project ON deployments(project_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_deployments_idempotency ON deployments(idempotency_key);
        PRAGMA foreign_keys = ON;
      `);
    } else {
      if (!depCols.some((c) => c.name === "idempotency_key")) {
        this.db.exec("ALTER TABLE deployments ADD COLUMN idempotency_key TEXT;");
        this.db.exec(
          "CREATE INDEX IF NOT EXISTS idx_deployments_idempotency ON deployments(idempotency_key);"
        );
      }
      if (!depCols.some((c) => c.name === "error_message")) {
        this.db.exec("ALTER TABLE deployments ADD COLUMN error_message TEXT;");
      }
    }
  }

  static open(dbPath: string): NewtDatabase {
    return new NewtDatabase(dbPath);
  }

  static openInMemory(): NewtDatabase {
    return new NewtDatabase(":memory:");
  }

  close(): void {
    this.db.close();
  }

  // --- Projects ---

  createProject(params: {
    id?: string;
    ownerUid: string;
    limbId: string;
    name: string;
    mode: ProjectMode;
    baseTarget: string;
    initialFiles?: NewtVfs;
    initialSummary?: string;
  }): ProjectRecord {
    const now = Date.now();
    const id = params.id ?? makeId("proj");

    this.db
      .prepare(
        `INSERT INTO projects (id, owner_uid, limb_id, name, mode, base_target, current_snapshot_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`
      )
      .run(id, params.ownerUid, params.limbId, params.name, params.mode, params.baseTarget, now, now);

    if (params.initialFiles) {
      this.saveSnapshot({
        projectId: id,
        files: params.initialFiles,
        summary: params.initialSummary ?? "Initial project scaffold",
      });
    }

    return this.getProject(id)!;
  }

  getProject(projectId: string): ProjectRecord | null {
    const row = this.db
      .prepare("SELECT * FROM projects WHERE id = ?")
      .get(projectId) as Record<string, unknown> | undefined;
    return row ? asProject(row) : null;
  }

  getProjectByLimbId(limbId: string): ProjectRecord | null {
    const row = this.db
      .prepare("SELECT * FROM projects WHERE limb_id = ?")
      .get(limbId) as Record<string, unknown> | undefined;
    return row ? asProject(row) : null;
  }

  listProjects(ownerUid?: string): ProjectRecord[] {
    if (ownerUid !== undefined) {
      return this.listProjectsByOwner(ownerUid);
    }
    const rows = this.db
      .prepare("SELECT * FROM projects ORDER BY updated_at DESC")
      .all() as Array<Record<string, unknown>>;
    return rows.map(asProject);
  }

  listProjectsByOwner(ownerUid: string): ProjectRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM projects WHERE owner_uid = ? ORDER BY updated_at DESC")
      .all(ownerUid) as Array<Record<string, unknown>>;
    return rows.map(asProject);
  }

  deleteProject(projectId: string): boolean {
    const res = this.db.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
    return Number(res.changes) > 0;
  }

  // --- Immutable VFS Snapshots & 1-Click Rollback ---

  saveSnapshot(params: {
    projectId: string;
    files: NewtVfs;
    compiledBundle?: CompiledLimbBundle | null;
    summary: string;
    parentSnapshotId?: number | null;
  }): VfsSnapshotRecord {
    const project = this.getProject(params.projectId);
    if (!project) {
      throw new Error(`Project '${params.projectId}' not found`);
    }

    const parentId =
      params.parentSnapshotId !== undefined
        ? params.parentSnapshotId
        : project.currentSnapshotId;
    const now = Date.now();
    const filesJson = JSON.stringify(params.files);
    const compiledJson = params.compiledBundle ? JSON.stringify(params.compiledBundle) : null;

    const info = this.db
      .prepare(
        `INSERT INTO vfs_snapshots (project_id, parent_snapshot_id, files_json, compiled_bundle_json, summary, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(params.projectId, parentId, filesJson, compiledJson, params.summary, now);

    const newId = Number(info.lastInsertRowid);
    this.db
      .prepare("UPDATE projects SET current_snapshot_id = ?, updated_at = ? WHERE id = ?")
      .run(newId, now, params.projectId);

    return this.getSnapshot(newId)!;
  }

  getSnapshot(snapshotId: number): VfsSnapshotRecord | null {
    const row = this.db
      .prepare("SELECT * FROM vfs_snapshots WHERE id = ?")
      .get(snapshotId) as Record<string, unknown> | undefined;
    return row ? asSnapshot(row) : null;
  }

  getCurrentSnapshot(projectId: string): VfsSnapshotRecord | null {
    const project = this.getProject(projectId);
    if (!project || project.currentSnapshotId === null) return null;
    return this.getSnapshot(project.currentSnapshotId);
  }

  listSnapshots(projectId: string): VfsSnapshotRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM vfs_snapshots WHERE project_id = ? ORDER BY id DESC")
      .all(projectId) as Array<Record<string, unknown>>;
    return rows.map(asSnapshot);
  }

  rollbackProjectToSnapshot(projectId: string, targetSnapshotId: number): VfsSnapshotRecord {
    const target = this.getSnapshot(targetSnapshotId);
    if (!target || target.projectId !== projectId) {
      throw new Error(
        `Snapshot ${targetSnapshotId} does not belong to project '${projectId}'`
      );
    }
    const now = Date.now();
    this.db
      .prepare("UPDATE projects SET current_snapshot_id = ?, updated_at = ? WHERE id = ?")
      .run(targetSnapshotId, now, projectId);
    return target;
  }

  diffSnapshots(fromSnapshotId: number, toSnapshotId: number): VfsFileDiff[] {
    const fromSnap = this.getSnapshot(fromSnapshotId);
    const toSnap = this.getSnapshot(toSnapshotId);
    if (!fromSnap || !toSnap) {
      throw new Error("Cannot diff missing snapshot(s)");
    }

    const allPaths = Array.from(
      new Set([...Object.keys(fromSnap.files), ...Object.keys(toSnap.files)])
    ).sort();

    const diffs: VfsFileDiff[] = [];
    for (const filePath of allPaths) {
      const before = fromSnap.files[filePath];
      const after = toSnap.files[filePath];
      if (before === undefined && after !== undefined) {
        diffs.push({ path: filePath, status: "added", after });
      } else if (before !== undefined && after === undefined) {
        diffs.push({ path: filePath, status: "removed", before });
      } else if (before !== after) {
        diffs.push({ path: filePath, status: "modified", before, after });
      }
    }
    return diffs;
  }

  // --- Threads & Messages ---

  createThread(projectId: string): ThreadRecord {
    const id = makeId("thr");
    const now = Date.now();
    this.db
      .prepare("INSERT INTO threads (id, project_id, created_at) VALUES (?, ?, ?)")
      .run(id, projectId, now);
    return { id, projectId, createdAt: now };
  }

  listThreadsForProject(projectId: string): ThreadRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM threads WHERE project_id = ? ORDER BY created_at DESC")
      .all(projectId) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      projectId: String(r.project_id),
      createdAt: Number(r.created_at),
    }));
  }

  appendMessage(params: {
    threadId: string;
    role: MessageRole;
    content: unknown;
    snapshotId?: number | null;
  }): MessageRecord {
    const id = makeId("msg");
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO messages (id, thread_id, role, content_json, snapshot_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        params.threadId,
        params.role,
        JSON.stringify(params.content),
        params.snapshotId ?? null,
        now
      );
    return {
      id,
      threadId: params.threadId,
      role: params.role,
      content: params.content,
      snapshotId: params.snapshotId ?? null,
      createdAt: now,
    };
  }

  listMessages(threadId: string): MessageRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM messages WHERE thread_id = ? ORDER BY created_at ASC, rowid ASC")
      .all(threadId) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      threadId: String(r.thread_id),
      role: r.role as MessageRole,
      content: JSON.parse(String(r.content_json)),
      snapshotId:
        r.snapshot_id === null || r.snapshot_id === undefined ? null : Number(r.snapshot_id),
      createdAt: Number(r.created_at),
    }));
  }

  // --- Deployments ---

  recordDeployment(params: {
    projectId: string;
    snapshotId: number;
    principalUid: string;
    environment: DeploymentEnvironment;
    publishedDigest?: string | null;
    status?: DeploymentStatus;
    idempotencyKey?: string | null;
    errorMessage?: string | null;
  }): DeploymentRecord {
    const id = makeId("dep");
    const now = Date.now();
    const status: DeploymentStatus = params.status ?? "active";
    this.db
      .prepare(
        `INSERT INTO deployments (id, project_id, snapshot_id, principal_uid, environment, published_digest, status, idempotency_key, error_message, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        params.projectId,
        params.snapshotId,
        params.principalUid,
        params.environment,
        params.publishedDigest ?? null,
        status,
        params.idempotencyKey ?? null,
        params.errorMessage ?? null,
        now
      );
    return {
      id,
      projectId: params.projectId,
      snapshotId: params.snapshotId,
      principalUid: params.principalUid,
      environment: params.environment,
      publishedDigest: params.publishedDigest ?? null,
      status,
      idempotencyKey: params.idempotencyKey ?? null,
      errorMessage: params.errorMessage ?? null,
      createdAt: now,
    };
  }

  private static asDeployment(r: Record<string, unknown>): DeploymentRecord {
    return {
      id: String(r.id),
      projectId: String(r.project_id),
      snapshotId: Number(r.snapshot_id),
      principalUid: String(r.principal_uid),
      environment: r.environment as DeploymentEnvironment,
      publishedDigest: r.published_digest ? String(r.published_digest) : null,
      status: r.status as DeploymentStatus,
      idempotencyKey: r.idempotency_key ? String(r.idempotency_key) : null,
      errorMessage: r.error_message ? String(r.error_message) : null,
      createdAt: Number(r.created_at),
    };
  }

  listDeploymentsForProject(projectId: string): DeploymentRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM deployments WHERE project_id = ? ORDER BY created_at DESC, rowid DESC")
      .all(projectId) as Array<Record<string, unknown>>;
    return rows.map((r) => NewtDatabase.asDeployment(r));
  }

  getLatestDeploymentForProject(projectId: string): DeploymentRecord | null {
    const row = this.db
      .prepare("SELECT * FROM deployments WHERE project_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1")
      .get(projectId) as Record<string, unknown> | undefined;
    return row ? NewtDatabase.asDeployment(row) : null;
  }

  getDeploymentByIdempotencyKey(idempotencyKey: string): DeploymentRecord | null {
    const row = this.db
      .prepare("SELECT * FROM deployments WHERE idempotency_key = ? ORDER BY created_at DESC, rowid DESC LIMIT 1")
      .get(idempotencyKey) as Record<string, unknown> | undefined;
    return row ? NewtDatabase.asDeployment(row) : null;
  }

  // --- Gallery Listings & Monetization Entitlements ---

  upsertGalleryListing(params: Omit<GalleryListingRecord, "installsCount" | "publishedAt">): GalleryListingRecord {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO gallery_listings (
           limb_id, project_id, author_uid, title, description, base_target,
           published_digest, visibility, monetization_mode, price_label,
           permissions_summary_json, installs_count, published_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
         ON CONFLICT(limb_id) DO UPDATE SET
           title = excluded.title,
           description = excluded.description,
           published_digest = excluded.published_digest,
           visibility = excluded.visibility,
           monetization_mode = excluded.monetization_mode,
           price_label = excluded.price_label,
           permissions_summary_json = excluded.permissions_summary_json,
           published_at = excluded.published_at`
      )
      .run(
        params.limbId,
        params.projectId,
        params.authorUid,
        params.title,
        params.description,
        params.baseTarget,
        params.publishedDigest,
        params.visibility,
        params.monetizationMode,
        params.priceLabel,
        JSON.stringify(params.permissionsSummary),
        now
      );
    return this.getGalleryListing(params.limbId)!;
  }

  getGalleryListing(limbId: string): GalleryListingRecord | null {
    const row = this.db
      .prepare("SELECT * FROM gallery_listings WHERE limb_id = ?")
      .get(limbId) as Record<string, unknown> | undefined;
    return row ? asGalleryListing(row) : null;
  }

  listPublicGallery(baseTarget?: string): GalleryListingRecord[] {
    const rows = baseTarget
      ? (this.db
          .prepare(
            "SELECT * FROM gallery_listings WHERE visibility = 'public' AND base_target = ? ORDER BY published_at DESC"
          )
          .all(baseTarget) as Array<Record<string, unknown>>)
      : (this.db
          .prepare(
            "SELECT * FROM gallery_listings WHERE visibility = 'public' ORDER BY published_at DESC"
          )
          .all() as Array<Record<string, unknown>>);
    return rows.map(asGalleryListing);
  }

  grantEntitlement(params: {
    limbId: string;
    consumerUid: string;
    grantSource: EntitlementSource;
    externalReceiptId?: string | null;
  }): EntitlementGrantRecord {
    const id = makeId("ent");
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO entitlement_grants (id, limb_id, consumer_uid, grant_source, external_receipt_id, granted_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(limb_id, consumer_uid) DO UPDATE SET
           grant_source = excluded.grant_source,
           external_receipt_id = excluded.external_receipt_id,
           granted_at = excluded.granted_at`
      )
      .run(
        id,
        params.limbId,
        params.consumerUid,
        params.grantSource,
        params.externalReceiptId ?? null,
        now
      );
    this.db
      .prepare("UPDATE gallery_listings SET installs_count = installs_count + 1 WHERE limb_id = ?")
      .run(params.limbId);

    return {
      id,
      limbId: params.limbId,
      consumerUid: params.consumerUid,
      grantSource: params.grantSource,
      externalReceiptId: params.externalReceiptId ?? null,
      grantedAt: now,
    };
  }

  hasEntitlement(limbId: string, consumerUid: string): boolean {
    const listing = this.getGalleryListing(limbId);
    if (!listing) return false;
    if (listing.authorUid === consumerUid || listing.monetizationMode === "free") {
      return true;
    }
    const row = this.db
      .prepare("SELECT 1 AS ok FROM entitlement_grants WHERE limb_id = ? AND consumer_uid = ?")
      .get(limbId, consumerUid) as { ok?: number } | undefined;
    return Boolean(row?.ok);
  }
}
