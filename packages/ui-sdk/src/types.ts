export type SidecarScope = "personal" | "shared" | "scratch";
export type SlotCardinality = "singleton" | "repeater";
export type ThemeMode = "light" | "dark";
export type LimbHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface NewtBootConfig {
  limbId: string;
  slotId: string;
  cardinality?: SlotCardinality;
  instanceKey?: string;
  defaultRoute?: string;
  defaultProps?: Record<string, string>;
  defaultTheme?: ThemeMode;
}

export interface SlotContext<P extends Record<string, string> = Record<string, string>> {
  limbId: string;
  slotId: string;
  cardinality: SlotCardinality;
  instanceKey: string;
  route: string;
  props: P;
  theme: ThemeMode;
  ready: boolean;
}

export type BrokerRpcPayload =
  | {
      op: "sidecar_query";
      limb_id: string;
      scope: SidecarScope;
      sql: string;
      params: ReadonlyArray<string | number | boolean | null>;
    }
  | {
      op: "sidecar_execute";
      limb_id: string;
      scope: SidecarScope;
      sql: string;
      params: ReadonlyArray<string | number | boolean | null>;
    }
  | {
      op: "canonical_read";
      limb_id: string;
      collection: string;
      doc_id: string;
    }
  | {
      op: "limb_invoke";
      limb_id: string;
      route: string;
      method: LimbHttpMethod;
      body: unknown;
    };

export interface BrokerRpcReplyEnvelope {
  channel: "salamanda.broker.v1.reply";
  requestId: string;
  response: {
    ok: boolean;
    data?: unknown;
    error?: string;
  };
}

export interface ContextReplyEnvelope {
  channel: "salamanda.context.reply.v1";
  requestId?: string;
  limbId?: string;
  slotId?: string;
  instanceKey?: string;
  route?: string;
  context?: Record<string, string>;
  theme?: ThemeMode;
  cssVars?: Record<string, string>;
}

declare global {
  interface Window {
    __NEWT_BOOT__?: NewtBootConfig;
  }
}
