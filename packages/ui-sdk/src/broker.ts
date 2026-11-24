import type {
  BrokerRpcPayload,
  BrokerRpcReplyEnvelope,
  LimbHttpMethod,
  NewtBootConfig,
  SidecarScope,
} from "./types.js";

let reqSeq = 0;

export function getBootConfig(): NewtBootConfig {
  const boot = typeof window !== "undefined" ? window.__NEWT_BOOT__ : undefined;
  return {
    limbId: boot?.limbId ?? "unknown-limb",
    slotId: boot?.slotId ?? "unknown.slot",
    cardinality: boot?.cardinality ?? "singleton",
    instanceKey: boot?.instanceKey ?? "default",
    defaultRoute: boot?.defaultRoute ?? "/",
    defaultProps: boot?.defaultProps ?? {},
    defaultTheme: boot?.defaultTheme ?? "light",
  };
}

interface PendingRpc {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pendingMap = new Map<string, PendingRpc>();
let listenerBound = false;

function ensureReplyListener(): void {
  if (listenerBound || typeof window === "undefined") return;
  listenerBound = true;

  window.addEventListener("message", (event: MessageEvent) => {
    const msg = event.data as BrokerRpcReplyEnvelope | undefined;
    if (!msg || msg.channel !== "salamanda.broker.v1.reply" || !msg.requestId) {
      return;
    }
    const entry = pendingMap.get(msg.requestId);
    if (!entry) return;

    pendingMap.delete(msg.requestId);
    clearTimeout(entry.timer);

    if (msg.response?.ok) {
      entry.resolve(msg.response.data);
    } else {
      entry.reject(new Error(msg.response?.error ?? "Salamanda broker RPC rejected"));
    }
  });
}

export function callBrokerRpc<T = unknown>(
  payload: BrokerRpcPayload,
  timeoutMs = 8000
): Promise<T> {
  if (typeof window === "undefined" || !window.parent) {
    return Promise.reject(new Error("Salamanda broker unavailable outside browser iframe"));
  }

  ensureReplyListener();
  const requestId = `newt_rpc_${++reqSeq}_${Date.now().toString(36)}`;

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingMap.delete(requestId);
      reject(new Error(`Broker RPC timed out after ${timeoutMs}ms (${payload.op})`));
    }, timeoutMs);

    pendingMap.set(requestId, {
      resolve: (d) => resolve(d as T),
      reject,
      timer,
    });

    window.parent.postMessage(
      {
        channel: "salamanda.broker.v1",
        requestId,
        payload,
      },
      "*"
    );
  });
}

export async function querySidecar<T = Record<string, unknown>>(
  scope: SidecarScope,
  sql: string,
  params: ReadonlyArray<string | number | boolean | null> = [],
  timeoutMs?: number
): Promise<T[]> {
  const { limbId } = getBootConfig();
  const res = await callBrokerRpc<{ rows?: T[] } | T[]>(
    {
      op: "sidecar_query",
      limb_id: limbId,
      scope,
      sql,
      params,
    },
    timeoutMs
  );
  if (Array.isArray(res)) return res;
  return res?.rows ?? [];
}

export async function executeSidecar(
  scope: SidecarScope,
  sql: string,
  params: ReadonlyArray<string | number | boolean | null> = [],
  timeoutMs?: number
): Promise<{ rowsAffected: number }> {
  const { limbId } = getBootConfig();
  const res = await callBrokerRpc<{ rowsAffected?: number }>(
    {
      op: "sidecar_execute",
      limb_id: limbId,
      scope,
      sql,
      params,
    },
    timeoutMs
  );
  return { rowsAffected: res?.rowsAffected ?? 0 };
}

export async function readCanonical<T = Record<string, unknown>>(
  collection: string,
  docId: string,
  timeoutMs?: number
): Promise<T | null> {
  const { limbId } = getBootConfig();
  const res = await callBrokerRpc<{ document?: T | null } | T | null>(
    {
      op: "canonical_read",
      limb_id: limbId,
      collection,
      doc_id: docId,
    },
    timeoutMs
  );
  if (res && typeof res === "object" && "document" in res) {
    return (res as { document?: T | null }).document ?? null;
  }
  return (res as T | null) ?? null;
}

/**
 * Invokes a Level 2 sandboxed function (`/_limb/<limbId>/*`) via the parent window's
 * capability broker so `origin: null` `srcdoc` iframes preserve verified session cookies.
 */
export async function invokeLimbFunction<TReq = unknown, TRes = unknown>(
  route: string,
  body?: TReq,
  method: LimbHttpMethod = "POST",
  timeoutMs?: number
): Promise<TRes> {
  const { limbId } = getBootConfig();
  const normalizedRoute = route.startsWith("/_limb/")
    ? route
    : `/_limb/${limbId}/${route.replace(/^\/+/, "")}`;

  return callBrokerRpc<TRes>(
    {
      op: "limb_invoke",
      limb_id: limbId,
      route: normalizedRoute,
      method,
      body: body ?? {},
    },
    timeoutMs
  );
}
