/**
 * Salamanda Host API v1.0.0 (`host-api.d.ts`)
 *
 * Typed host environment available inside Level 2 Sandboxed Functions
 * and Level 3 Variant helpers, plus the Browser Slot Capability Broker.
 */

export type SidecarScope = "personal" | "shared" | "scratch";

export interface PrincipalContext {
  /** Verified principal UID (e.g. Firebase UID). Never spoofable by cookies. */
  readonly uid: string;
  /** Active limb ID executing the request. */
  readonly limbId: string;
  /** Active limb version. */
  readonly limbVersion: string;
}

export interface SqlRow {
  [column: string]: string | number | boolean | null | Uint8Array;
}

export interface SidecarDatabase {
  /**
   * Execute a read-only parameterized SQL query against the limb's sidecar SQLite database.
   */
  query<T extends SqlRow = SqlRow>(
    scope: SidecarScope,
    sql: string,
    params?: ReadonlyArray<string | number | boolean | null>
  ): Promise<T[]>;

  /**
   * Execute a write parameterized SQL statement (INSERT, UPDATE, DELETE) against the sidecar store.
   */
  execute(
    scope: SidecarScope,
    sql: string,
    params?: ReadonlyArray<string | number | boolean | null>
  ): Promise<{ rowsAffected: number; lastInsertRowid?: number }>;
}

export interface CanonicalDataBridge {
  /**
   * Read canonical base platform entities on behalf of the current verified principal.
   * Uses a short-lived user-scoped credential minted by the Salamanda Credential Broker,
   * ensuring all upstream Firestore / base security rules are enforced.
   */
  readDocument<T = unknown>(collection: string, documentId: string): Promise<T | null>;

  /**
   * Query a canonical collection permitted by `permissions.data_read` in `limb.toml`.
   */
  queryCollection<T = unknown>(
    collection: string,
    filter?: { field: string; op: "==" | "<" | "<=" | ">" | ">="; value: string | number | boolean },
    limit?: number
  ): Promise<T[]>;
}

export interface EgressFetchOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

export interface EgressHttp {
  /**
   * Perform an outbound HTTP request to an external host explicitly listed
   * in `permissions.egress` in `limb.toml`.
   * Requests to RFC1918, loopback, or cloud metadata IPs are unconditionally blocked.
   */
  fetch(
    url: string,
    options?: EgressFetchOptions
  ): Promise<{ status: number; headers: Record<string, string>; bodyText: string }>;
}

export interface SalamandaHost {
  readonly principal: PrincipalContext;
  readonly sidecar: SidecarDatabase;
  readonly canonical: CanonicalDataBridge;
  readonly http: EgressHttp;
}

declare global {
  const salamanda: SalamandaHost;
}
