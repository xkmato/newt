import { JSDOM } from "jsdom";
import type { Database, SqlValue } from "sql.js";
import type { BasePack } from "@newt/base-sdk";
import type { SidecarScope } from "@newt/contract";
import { containsForbiddenSqliteDirective, getSqlJs } from "./sql-verifier.js";
import type { CompiledFunctionDescriptor, CompiledLimbBundle, HostApiCall } from "./types.js";

interface MountedFrameSession {
  limbId: string;
  slotId: string;
  instanceKey: string;
  principalUid: string;
  route: string;
  contextProps: Record<string, string>;
  theme: "light" | "dark";
  replyToFrame: (message: unknown) => void;
}

function interpolateSqlTemplate(
  template: string,
  principalUid: string,
  body: unknown
): string {
  const safeUid = principalUid.replace(/'/g, "''");
  let sql = template.replace(/\$\{principal\.uid\}/g, safeUid);
  if (body && typeof body === "object") {
    for (const [key, val] of Object.entries(body as Record<string, unknown>)) {
      const placeholder = `\${body.${key}}`;
      let replacement = "";
      if (typeof val === "string") replacement = val.replace(/'/g, "''");
      else if (typeof val === "number" || typeof val === "boolean") replacement = String(val);
      sql = sql.split(placeholder).join(replacement);
    }
  }
  return sql;
}

/**
 * Multi-platform `MockSalamandaHostBroker` backed by in-memory WebAssembly SQLite (`sql.js`)
 * and any `BasePack`'s canonical fixtures.
 *
 * - Used inside Standalone Newt Studio so users can build, click, and inspect SQLite
 *   sidecars across both `singleton` (`blog.sidebar`) and `repeater` (`micropost.footer`)
 *   slots without needing a running Rust `salamanda` daemon or live base server.
 * - Strictly pins `event.source` per mounted iframe so two opaque (`origin: "null"`)
 *   sandboxed Limbs cannot spoof each other's `limb_id` or read unauthorized sidecars.
 */
export class MockSalamandaHostBroker {
  private readonly sidecarDbs = new Map<string, Database>();
  private readonly registeredLimbs = new Map<string, CompiledLimbBundle>();
  private readonly mountedFrames = new Map<object, MountedFrameSession>();
  private readonly egressFetcher: (url: string) => Promise<{ status: number; bodyText: string }>;

  constructor(
    private readonly basePack: BasePack<Record<string, Array<Record<string, unknown>>>>,
    options?: {
      egressFetcher?: (url: string) => Promise<{ status: number; bodyText: string }>;
    }
  ) {
    this.egressFetcher =
      options?.egressFetcher ??
      (async (url: string) => ({
        status: 200,
        bodyText: JSON.stringify({ simulated: true, url }),
      }));
  }

  private sidecarKey(scope: SidecarScope, principalUid: string, limbId: string): string {
    if (scope === "shared") return `shared::limb__${limbId}`;
    if (scope === "scratch") return `scratch::${principalUid}__${limbId}`;
    return `personal::${principalUid}__${limbId}`;
  }

  private async getOrOpenSidecarDb(
    scope: SidecarScope,
    principalUid: string,
    limbId: string
  ): Promise<Database> {
    if (scope === "none") {
      throw new Error(`Limb '${limbId}' has sidecar scope 'none'`);
    }
    const key = this.sidecarKey(scope, principalUid, limbId);
    const existing = this.sidecarDbs.get(key);
    if (existing) return existing;

    const SQL = await getSqlJs();
    const db = new SQL.Database();
    const bundle = this.registeredLimbs.get(limbId);
    if (bundle) {
      const migrationKeys = Object.keys(bundle.assets)
        .filter((k) => k.startsWith("migrations/") && k.endsWith(".sql"))
        .sort();
      for (const mKey of migrationKeys) {
        const ddl = bundle.assets[mKey];
        if (ddl) db.run(ddl);
      }
    }
    this.sidecarDbs.set(key, db);
    return db;
  }

  async registerLimb(
    bundle: CompiledLimbBundle,
    options?: { seedSql?: string; seedPrincipalUid?: string }
  ): Promise<void> {
    if (!bundle.manifest) {
      throw new Error("Cannot register invalid Limb bundle without parsed manifest");
    }
    this.registeredLimbs.set(bundle.limbId, bundle);

    const scope = bundle.manifest.permissions.sidecar;
    if (scope !== "none") {
      const uid = options?.seedPrincipalUid ?? "uid:studio";
      const db = await this.getOrOpenSidecarDb(scope, uid, bundle.limbId);
      if (options?.seedSql) {
        db.run(options.seedSql);
      }
    }
  }

  registerFrameSource(sourceToken: object, session: MountedFrameSession): void {
    this.mountedFrames.set(sourceToken, session);
  }

  async handleFrameMessage(sourceToken: object, rawMsg: unknown): Promise<void> {
    const session = this.mountedFrames.get(sourceToken);
    if (!session || !rawMsg || typeof rawMsg !== "object") return;

    const msg = rawMsg as {
      channel?: string;
      requestId?: string;
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

    if (msg.channel === "salamanda.context.request.v1") {
      session.replyToFrame({
        channel: "salamanda.context.reply.v1",
        requestId: msg.requestId,
        limbId: session.limbId,
        slotId: session.slotId,
        instanceKey: session.instanceKey,
        route: session.route,
        context: session.contextProps,
        theme: session.theme,
      });
      return;
    }

    if (msg.channel !== "salamanda.broker.v1" || !msg.requestId || !msg.payload) {
      return;
    }

    const reply = (ok: boolean, data?: unknown, error?: string) => {
      session.replyToFrame({
        channel: "salamanda.broker.v1.reply",
        requestId: msg.requestId,
        response: ok ? { ok: true, data } : { ok: false, error },
      });
    };

    try {
      const payload = msg.payload;
      // Enforce pinned source identity: frame cannot impersonate a different limb_id
      if (payload.limb_id && payload.limb_id !== session.limbId) {
        throw new Error(
          `Broker source mismatch: frame '${session.limbId}' cannot act as '${payload.limb_id}'`
        );
      }

      const bundle = this.registeredLimbs.get(session.limbId);
      if (!bundle?.manifest) {
        throw new Error(`Limb '${session.limbId}' is not active`);
      }
      const perms = bundle.manifest.permissions;

      if (payload.op === "sidecar_query") {
        const scope = payload.scope ?? "none";
        if (perms.sidecar === "none" || perms.sidecar !== scope) {
          throw new Error(`Limb '${session.limbId}' is not granted sidecar scope '${scope}'`);
        }
        const sql = payload.sql ?? "";
        if (!sql.trim().toUpperCase().startsWith("SELECT")) {
          throw new Error("sidecar_query only permits SELECT statements");
        }
        const db = await this.getOrOpenSidecarDb(scope, session.principalUid, session.limbId);
        const rows = this.queryPrepared(db, sql, payload.params ?? []);
        reply(true, { rows });
        return;
      }

      if (payload.op === "sidecar_execute") {
        const scope = payload.scope ?? "none";
        if (perms.sidecar === "none" || perms.sidecar !== scope) {
          throw new Error(`Limb '${session.limbId}' is not granted sidecar scope '${scope}'`);
        }
        const sql = payload.sql ?? "";
        if (containsForbiddenSqliteDirective(sql)) {
          throw new Error("ATTACH DATABASE and PRAGMA are forbidden in sidecars");
        }
        const db = await this.getOrOpenSidecarDb(scope, session.principalUid, session.limbId);
        db.run(sql, payload.params ?? []);
        reply(true, { rowsAffected: db.getRowsModified() });
        return;
      }

      if (payload.op === "canonical_read") {
        const col = payload.collection ?? "";
        const docId = payload.doc_id ?? "";
        const sensitive = this.basePack.manifest.permissions_catalog?.sensitive_collections ?? [];
        if (sensitive.includes(col) || !perms.data_read.includes(col)) {
          throw new Error(`Limb '${session.limbId}' is not granted canonical data_read for '${col}'`);
        }
        const collectionDocs = this.basePack.fixtures[col] ?? [];
        const found =
          collectionDocs.find((d) => String(d.id) === docId || String(d.slug) === docId) ?? null;
        reply(true, { document: found });
        return;
      }

      if (payload.op === "limb_invoke") {
        const method = (payload.method ?? "POST").toUpperCase();
        const route = payload.route ?? "";
        const fnDesc = bundle.functions.find(
          (f) => f.method === method && f.route === route
        );
        if (!fnDesc) {
          throw new Error(`No bound L2 function handler for ${method} ${route}`);
        }
        const fnOut = await this.executeFunctionDescriptor(
          fnDesc,
          bundle,
          session.principalUid,
          payload.body ?? {}
        );
        reply(true, fnOut);
        return;
      }

      throw new Error(`Unsupported broker operation '${String(payload.op)}'`);
    } catch (err) {
      reply(false, undefined, err instanceof Error ? err.message : String(err));
    }
  }

  private queryPrepared(
    db: Database,
    sql: string,
    params: SqlValue[]
  ): Array<Record<string, SqlValue>> {
    const stmt = db.prepare(sql);
    try {
      if (params.length > 0) {
        stmt.bind(params);
      }
      const rows: Array<Record<string, SqlValue>> = [];
      while (stmt.step()) {
        if (rows.length >= 250) {
          throw new Error("Query exceeded max_rows_per_query limit (250)");
        }
        rows.push(stmt.getAsObject());
      }
      return rows;
    } finally {
      stmt.free();
    }
  }

  private async executeFunctionDescriptor(
    fnDesc: CompiledFunctionDescriptor,
    bundle: CompiledLimbBundle,
    principalUid: string,
    body: unknown
  ): Promise<unknown> {
    let lastOutput: unknown = { principal: principalUid, limb_id: bundle.limbId };
    const perms = bundle.manifest!.permissions;

    for (const op of fnDesc.operations) {
      lastOutput = await this.runSingleHostOp(op, bundle.limbId, perms.sidecar, principalUid, body);
    }
    return lastOutput;
  }

  private async runSingleHostOp(
    op: HostApiCall,
    limbId: string,
    grantedScope: SidecarScope,
    principalUid: string,
    body: unknown
  ): Promise<unknown> {
    if (op.host_call === "sidecar_execute") {
      const db = await this.getOrOpenSidecarDb(grantedScope, principalUid, limbId);
      const sql = interpolateSqlTemplate(op.sql_template, principalUid, body);
      db.run(sql);
      return { rowsAffected: db.getRowsModified() };
    }
    if (op.host_call === "sidecar_query") {
      const db = await this.getOrOpenSidecarDb(grantedScope, principalUid, limbId);
      const sql = interpolateSqlTemplate(op.sql_template, principalUid, body);
      return { rows: this.queryPrepared(db, sql, []) };
    }
    if (op.host_call === "canonical_read") {
      const docs = this.basePack.fixtures[op.collection] ?? [];
      const doc = docs.find((d) => String(d.id) === op.doc_id) ?? null;
      return { document: doc };
    }
    const fetched = await this.egressFetcher(op.url);
    return { egress_allowed: true, url: op.url, ...fetched };
  }

  async inspectSidecarTable(
    scope: SidecarScope,
    principalUid: string,
    limbId: string,
    tableName: string
  ): Promise<Array<Record<string, SqlValue>>> {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
      throw new Error(`Invalid SQLite table identifier '${tableName}'`);
    }
    const db = await this.getOrOpenSidecarDb(scope, principalUid, limbId);
    return this.queryPrepared(db, `SELECT * FROM ${tableName}`, []);
  }

  /**
   * Mounts a compiled Limb slot into an interactive JSDOM window wired directly to
   * this `MockSalamandaHostBroker` — supporting multiple concurrent repeater card instances!
   */
  mountSlotInJsdom(params: {
    limbId: string;
    slotId: string;
    principalUid?: string;
    instanceKey?: string;
    route?: string;
    contextProps?: Record<string, string>;
    theme?: "light" | "dark";
  }): JSDOM {
    const bundle = this.registeredLimbs.get(params.limbId);
    if (!bundle?.manifest) {
      throw new Error(`Limb '${params.limbId}' is not registered in MockSalamandaHostBroker`);
    }
    const uiMount = bundle.manifest.ui?.find((u) => u.slot === params.slotId);
    if (!uiMount) {
      throw new Error(`Limb '${params.limbId}' has no [[ui]] entry for slot '${params.slotId}'`);
    }
    const html = bundle.assets[uiMount.component];
    if (!html) {
      throw new Error(`Compiled HTML asset '${uiMount.component}' missing from bundle`);
    }

    const sourceToken = {};
    const broker = this;

    const dom = new JSDOM(html, {
      url: "about:blank",
      runScripts: "dangerously",
      pretendToBeVisual: true,
      beforeParse(win) {
        broker.registerFrameSource(sourceToken, {
          limbId: params.limbId,
          slotId: params.slotId,
          instanceKey: params.instanceKey ?? "default",
          principalUid: params.principalUid ?? "uid:studio",
          route: params.route ?? "/",
          contextProps: params.contextProps ?? {},
          theme: params.theme ?? "light",
          replyToFrame: (replyPayload) => {
            setTimeout(() => {
              try {
                win.dispatchEvent(new win.MessageEvent("message", { data: replyPayload }));
              } catch {
                // window closed
              }
            }, 1);
          },
        });

        Object.defineProperty(win, "parent", {
          value: {
            postMessage: (outMsg: unknown) => {
              void broker.handleFrameMessage(sourceToken, outMsg);
            },
          },
        });
      },
    });

    return dom;
  }

  closeAll(): void {
    for (const db of this.sidecarDbs.values()) {
      db.close();
    }
    this.sidecarDbs.clear();
    this.mountedFrames.clear();
  }
}
