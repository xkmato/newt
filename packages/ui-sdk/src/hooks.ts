import { useCallback, useEffect, useState } from "preact/hooks";
import { getBootConfig, querySidecar } from "./broker.js";
import type {
  ContextReplyEnvelope,
  SidecarScope,
  SlotContext,
  ThemeMode,
} from "./types.js";

function applyThemeToDocument(
  theme: ThemeMode,
  cssVars?: Record<string, string>
): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.setAttribute("data-newt-theme", theme);
  root.classList.toggle("dark", theme === "dark");
  if (cssVars) {
    for (const [key, val] of Object.entries(cssVars)) {
      if (key.startsWith("--") && typeof val === "string") {
        root.style.setProperty(key, val);
      }
    }
  }
}

export function useSlotContext<
  P extends Record<string, string> = Record<string, string>,
>(): SlotContext<P> {
  const boot = getBootConfig();
  const [ctx, setCtx] = useState<SlotContext<P>>(() => ({
    limbId: boot.limbId,
    slotId: boot.slotId,
    cardinality: boot.cardinality ?? "singleton",
    instanceKey: boot.instanceKey ?? "default",
    route: boot.defaultRoute ?? "/",
    props: (boot.defaultProps ?? {}) as P,
    theme: boot.defaultTheme ?? "light",
    ready: false,
  }));

  useEffect(() => {
    if (typeof window === "undefined") return;
    applyThemeToDocument(boot.defaultTheme ?? "light");

    const onMessage = (event: MessageEvent) => {
      const msg = event.data as ContextReplyEnvelope | undefined;
      if (!msg || msg.channel !== "salamanda.context.reply.v1") return;

      const nextTheme = msg.theme ?? "light";
      applyThemeToDocument(nextTheme, msg.cssVars);

      setCtx((prev) => ({
        ...prev,
        instanceKey: msg.instanceKey ?? prev.instanceKey,
        route: msg.route ?? prev.route,
        props: ((msg.context ? { ...prev.props, ...msg.context } : prev.props) as P),
        theme: nextTheme,
        ready: true,
      }));
    };

    window.addEventListener("message", onMessage);
    window.parent?.postMessage(
      {
        channel: "salamanda.context.request.v1",
        requestId: `ctx_${Date.now().toString(36)}`,
        limbId: boot.limbId,
        slotId: boot.slotId,
        instanceKey: boot.instanceKey ?? "default",
      },
      "*"
    );

    return () => window.removeEventListener("message", onMessage);
  }, [boot.limbId, boot.slotId, boot.instanceKey, boot.defaultTheme]);

  return ctx;
}

export function usePlatformTheme(): { theme: ThemeMode } {
  const { theme } = useSlotContext();
  return { theme };
}

export function useSidecarQuery<T = Record<string, unknown>>(
  scope: SidecarScope,
  sql: string,
  params: ReadonlyArray<string | number | boolean | null> = []
): {
  data: T[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
} {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const paramsKey = JSON.stringify(params);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await querySidecar<T>(scope, sql, params);
      setData(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [scope, sql, paramsKey]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { data, loading, error, refetch };
}
