import type { Database, SqlJsStatic, SqlValue } from "sql.js";
import type { CompiledLimbBundle, NewtVfs } from "@newt/compiler";
import type { SidecarScope } from "@newt/contract";
import type { BasePackDto } from "./types";

type OriginLike = {
  readonly opaque: boolean;
  isSameOrigin(other: OriginLike): boolean;
};

interface OriginConstructorLike {
  new (): OriginLike;
  from(value: unknown): OriginLike;
}

function getNativeOriginCtor(): OriginConstructorLike | null {
  if ("Origin" in globalThis) {
    const ctor = (globalThis as unknown as { Origin?: OriginConstructorLike }).Origin;
    if (ctor && typeof ctor.from === "function") {
      return ctor;
    }
  }
  return null;
}

function containsForbiddenSqliteDirective(sql: string): boolean {
  return /\bATTACH\s+DATABASE\b/i.test(sql) || /\bPRAGMA\b/i.test(sql);
}

export interface MountedIframeRegistration {
  frameWindow: Window;
  limbId: string;
  slotId: string;
  instanceKey: string;
  route: string;
  contextProps: Record<string, string>;
  theme: "light" | "dark";
  cssVars?: Record<string, string>;
  onResize?: (height: number) => void;
  pinnedOrigin?: OriginLike;
  originPinned?: boolean;
}

export interface SidecarTableInfo {
  dbKey: string;
  scope: SidecarScope;
  limbId: string;
  tableName: string;
  rowCount: number;
}

let sqlJsPromise: Promise<SqlJsStatic> | null = null;

async function loadBrowserSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJsPromise) {
    sqlJsPromise = import("sql.js").then((mod) => {
      const initSqlJs = (mod.default ?? mod) as unknown as (opts: {
        locateFile: (file: string) => string;
      }) => Promise<SqlJsStatic>;
      return initSqlJs({
        locateFile: () => "/sql-wasm.wasm",
      });
    });
  }
  return sqlJsPromise;
}

/**
 * In-browser WebAssembly `sql.js` Host Broker powering Standalone Newt Studio's
 * Pluggable Base Shell Simulator & live SQLite Sidecar Explorer.
 *
 * Security: Strictly pins each sandboxed `<iframe sandbox="allow-scripts">` sender via
 * `Origin.from(event)` when the native `Origin` API is available (preventing opaque `"null"`
 * origin collisions), falling back to `event.source === iframe.contentWindow` verification.
 */
export class BrowserSalamandaHostBroker {
  private readonly sidecarDbs = new Map<string, Database>();
  private readonly frames = new Map<Window, MountedIframeRegistration>();
  private readonly listeners = new Set<() => void>();
  private activeBundle: CompiledLimbBundle | null = null;
  private activeVfs: NewtVfs = {};
  private activeBase: BasePackDto | null = null;
  private principalUid = "uid:studio";
  private messageListener: ((ev: MessageEvent) => void) | null = null;

  start(): void {
    if (this.messageListener || typeof window === "undefined") return;
    this.messageListener = (event: MessageEvent) => {
      void this.handleMessageEvent(event);
    };
    window.addEventListener("message", this.messageListener);
  }

  stop(): void {
    if (this.messageListener && typeof window !== "undefined") {
      window.removeEventListener("message", this.messageListener);
      this.messageListener = null;
    }
    this.frames.clear();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  async configureActiveLimb(params: {
    base: BasePackDto;
    bundle: CompiledLimbBundle | null;
    vfs: NewtVfs;
    principalUid?: string;
    resetSidecar?: boolean;
  }): Promise<void> {
    this.activeBase = params.base;
    this.activeBundle = params.bundle;
    this.activeVfs = params.vfs;
    this.principalUid = params.principalUid ?? "uid:studio";

    if (params.resetSidecar) {
      for (const db of this.sidecarDbs.values()) {
        db.close();
      }
      this.sidecarDbs.clear();
    }

    if (params.bundle?.manifest && params.bundle.manifest.permissions.sidecar !== "none") {
      await this.getOrOpenDb(
        params.bundle.manifest.permissions.sidecar,
        params.bundle.limbId
      );
    }
    this.notify();
  }

  registerFrame(reg: MountedIframeRegistration): () => void {
    const OriginCtor = getNativeOriginCtor();
    const entry: MountedIframeRegistration = {
      ...reg,
      pinnedOrigin: OriginCtor ? new OriginCtor() : undefined,
      originPinned: false,
    };
    this.frames.set(reg.frameWindow, entry);
    return () => {
      this.frames.delete(reg.frameWindow);
    };
  }

  broadcastTheme(theme: "light" | "dark", cssVars?: Record<string, string>): void {
    for (const [win, session] of this.frames.entries()) {
      session.theme = theme;
      session.cssVars = cssVars;
      try {
        win.postMessage(
          {
            channel: "salamanda.context.reply.v1",
            limbId: session.limbId,
            slotId: session.slotId,
            instanceKey: session.instanceKey,
            route: session.route,
            context: session.contextProps,
            theme,
            cssVars,
          },
          "*"
        );
      } catch {
        // iframe unmounted
      }
    }
  }

  private sidecarKey(scope: SidecarScope, limbId: string): string {
    if (scope === "shared") return `shared::limb__${limbId}`;
    if (scope === "scratch") return `scratch::${this.principalUid}__${limbId}`;
    return `personal::${this.principalUid}__${limbId}`;
  }

  private async getOrOpenDb(scope: SidecarScope, limbId: string): Promise<Database> {
    const key = this.sidecarKey(scope, limbId);
    const existing = this.sidecarDbs.get(key);
    if (existing) return existing;

    const SQL = await loadBrowserSqlJs();
    const db = new SQL.Database();

    if (this.activeBundle && this.activeBundle.limbId === limbId) {
      const migrationKeys = Object.keys(this.activeBundle.assets)
        .filter((k) => k.startsWith("migrations/") && k.endsWith(".sql"))
        .sort();
      for (const mKey of migrationKeys) {
        const ddl = this.activeBundle.assets[mKey];
        if (ddl) db.run(ddl);
      }
    }

    const seedSql = this.activeVfs["fixtures/seed.sql"];
    if (seedSql && !containsForbiddenSqliteDirective(seedSql)) {
      try {
        db.run(seedSql);
      } catch {
        // Ignore seed collisions on re-init
      }
    }

    this.sidecarDbs.set(key, db);
    this.notify();
    return db;
  }

  private verifySandboxedFrameSender(
    event: MessageEvent,
    session: MountedIframeRegistration,
    isInitMessage: boolean
  ): boolean {
    if (event.source !== session.frameWindow) {
      return false;
    }

    const OriginCtor = getNativeOriginCtor();
    if (!OriginCtor) {
      // Fallback for browsers without native Origin interface: strict event.source match above
      return true;
    }

    try {
      const senderOrigin = OriginCtor.from(event);
      if (!session.originPinned && isInitMessage) {
        session.pinnedOrigin = senderOrigin;
        session.originPinned = true;
        return true;
      }
      if (!session.originPinned) {
        session.pinnedOrigin = senderOrigin;
        session.originPinned = true;
        return true;
      }
      return Boolean(session.pinnedOrigin && senderOrigin.isSameOrigin(session.pinnedOrigin));
    } catch {
      return event.source === session.frameWindow;
    }
  }

  private async handleMessageEvent(event: MessageEvent): Promise<void> {
    if (!event.source || typeof event.data !== "object" || event.data === null) return;
    const session = this.frames.get(event.source as Window);
    if (!session) return;

    const msg = event.data as {
      channel?: string;
      requestId?: string;
      height?: number;
      payload?: {
        op?: string;
        limb_id?: string;
        scope?: SidecarScope;
        sql?: string;
        params?: SqlValue[];
        collection?: string;
        doc_id?: string;
        route?: string;
        method?: string;
        body?: unknown;
      };
    };

    const isInit = msg.channel === "salamanda.context.request.v1";
    if (!this.verifySandboxedFrameSender(event, session, isInit)) {
      return;
    }

    if (isInit) {
      session.frameWindow.postMessage(
        {
          channel: "salamanda.context.reply.v1",
          requestId: msg.requestId,
          limbId: session.limbId,
          slotId: session.slotId,
          instanceKey: session.instanceKey,
          route: session.route,
          context: session.contextProps,
          theme: session.theme,
          cssVars: session.cssVars,
        },
        "*"
      );
      return;
    }

    if (msg.channel === "salamanda.resize.v1" && typeof msg.height === "number") {
      const clamped = Math.max(40, Math.min(1200, Math.ceil(msg.height)));
      session.onResize?.(clamped);
      return;
    }

    if (msg.channel !== "salamanda.broker.v1" || !msg.requestId || !msg.payload) {
      return;
    }

    const reply = (ok: boolean, data?: unknown, error?: string) => {
      try {
        session.frameWindow.postMessage(
          {
            channel: "salamanda.broker.v1.reply",
            requestId: msg.requestId,
            response: ok ? { ok: true, data } : { ok: false, error },
          },
          "*"
        );
      } catch {
        // frame gone
      }
    };

    try {
      const payload = msg.payload;
      if (payload.limb_id && payload.limb_id !== session.limbId) {
        throw new Error(`Frame '${session.limbId}' cannot spoof limb '${payload.limb_id}'`);
      }

      const manifest = this.activeBundle?.manifest;
      if (!manifest || this.activeBundle?.limbId !== session.limbId) {
        throw new Error(`Limb '${session.limbId}' is not active in simulator`);
      }
      const perms = manifest.permissions;

      if (payload.op === "sidecar_query") {
        const scope = payload.scope ?? "none";
        if (perms.sidecar === "none" || perms.sidecar !== scope) {
          throw new Error(`Limb '${session.limbId}' lacks sidecar scope '${scope}'`);
        }
        const sql = payload.sql ?? "";
        if (!sql.trim().toUpperCase().startsWith("SELECT")) {
          throw new Error("sidecar_query only allows SELECT queries");
        }
        const db = await this.getOrOpenDb(scope, session.limbId);
        const rows = this.runSelect(db, sql, payload.params ?? []);
        reply(true, { rows });
        return;
      }

      if (payload.op === "sidecar_execute") {
        const scope = payload.scope ?? "none";
        if (perms.sidecar === "none" || perms.sidecar !== scope) {
          throw new Error(`Limb '${session.limbId}' lacks sidecar scope '${scope}'`);
        }
        const sql = payload.sql ?? "";
        if (containsForbiddenSqliteDirective(sql)) {
          throw new Error("ATTACH DATABASE and PRAGMA are forbidden");
        }
        const db = await this.getOrOpenDb(scope, session.limbId);
        db.run(sql, payload.params ?? []);
        const rowsAffected = db.getRowsModified();
        this.notify();
        reply(true, { rowsAffected });
        return;
      }

      if (payload.op === "canonical_read") {
        const col = payload.collection ?? "";
        const docId = payload.doc_id ?? "";
        const sensitive = this.activeBase?.manifest.permissions_catalog?.sensitive_collections ?? [];
        if (sensitive.includes(col) || !perms.data_read.includes(col)) {
          throw new Error(`Limb '${session.limbId}' lacks data_read for '${col}'`);
        }
        const docs = this.activeBase?.fixtures[col] ?? [];
        const found = docs.find((d) => String(d.id) === docId || String(d.slug) === docId) ?? null;
        reply(true, { document: found });
        return;
      }

      if (payload.op === "limb_invoke") {
        reply(true, {
          simulated: true,
          route: payload.route,
          method: payload.method ?? "POST",
          principal: this.principalUid,
        });
        return;
      }

      throw new Error(`Unsupported broker op '${String(payload.op)}'`);
    } catch (err) {
      reply(false, undefined, err instanceof Error ? err.message : String(err));
    }
  }

  private runSelect(
    db: Database,
    sql: string,
    params: SqlValue[]
  ): Array<Record<string, SqlValue>> {
    const stmt = db.prepare(sql);
    try {
      if (params.length > 0) stmt.bind(params);
      const rows: Array<Record<string, SqlValue>> = [];
      while (stmt.step()) {
        if (rows.length >= 250) break;
        rows.push(stmt.getAsObject());
      }
      return rows;
    } finally {
      stmt.free();
    }
  }

  listTables(): SidecarTableInfo[] {
    const out: SidecarTableInfo[] = [];
    for (const [dbKey, db] of this.sidecarDbs.entries()) {
      const [scopePart, rest] = dbKey.split("::");
      const scope = (scopePart ?? "personal") as SidecarScope;
      const limbId = rest?.split("__").slice(1).join("__") ?? "unknown";
      const tables = this.runSelect(
        db,
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        []
      );
      for (const t of tables) {
        const tableName = String(t.name);
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) continue;
        const countRows = this.runSelect(db, `SELECT COUNT(*) AS cnt FROM ${tableName}`, []);
        out.push({
          dbKey,
          scope,
          limbId,
          tableName,
          rowCount: Number(countRows[0]?.cnt ?? 0),
        });
      }
    }
    return out;
  }

  executeInspectorQuery(
    dbKey: string,
    sql: string
  ): { columns: string[]; rows: Array<Record<string, SqlValue>>; error?: string } {
    const db = this.sidecarDbs.get(dbKey);
    if (!db) {
      return { columns: [], rows: [], error: `Sidecar database '${dbKey}' not open` };
    }
    const trimmed = sql.trim();
    if (!trimmed.toUpperCase().startsWith("SELECT")) {
      return { columns: [], rows: [], error: "Explorer only permits read-only SELECT queries" };
    }
    try {
      const rows = this.runSelect(db, trimmed, []);
      const columns = rows[0] ? Object.keys(rows[0]) : [];
      return { columns, rows };
    } catch (err) {
      return {
        columns: [],
        rows: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
