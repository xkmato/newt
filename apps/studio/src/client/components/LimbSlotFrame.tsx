"use client";

import { useEffect, useRef, useState } from "react";
import type { BrowserSalamandaHostBroker } from "../browser-broker";
import type { CompiledLimbBundle } from "../types";
import type { ResolvedTheme } from "./ThemeToggle";

export interface LimbSlotFrameProps {
  broker: BrowserSalamandaHostBroker;
  bundle: CompiledLimbBundle | null;
  slotId: string;
  route: string;
  instanceKey?: string;
  contextProps?: Record<string, string>;
  theme: ResolvedTheme;
  showSlotOutline?: boolean;
}

function getMountedAssetHtml(
  bundle: CompiledLimbBundle | null,
  slotId: string
): { limbId: string; html: string } | null {
  if (!bundle?.valid || !bundle.manifest?.ui) return null;
  const uiMount = bundle.manifest.ui.find((u) => u.slot === slotId);
  if (!uiMount) return null;
  const html = bundle.assets[uiMount.component];
  if (!html) return null;
  return { limbId: bundle.limbId, html };
}

export function LimbSlotFrame({
  broker,
  bundle,
  slotId,
  route,
  instanceKey = "default",
  contextProps = {},
  theme,
  showSlotOutline = false,
}: LimbSlotFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [height, setHeight] = useState(140);
  const mounted = getMountedAssetHtml(bundle, slotId);
  const contextKey = JSON.stringify(contextProps);

  const mountedKey = mounted ? `${mounted.limbId}:${mounted.html.length}:${slotId}:${instanceKey}` : "empty";

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!mounted || !iframe?.contentWindow) return;

    const unregister = broker.registerFrame({
      frameWindow: iframe.contentWindow,
      limbId: mounted.limbId,
      slotId,
      instanceKey,
      route,
      contextProps,
      theme,
      onResize: (h) => setHeight(h),
    });

    return () => {
      unregister();
    };
  }, [broker, mountedKey, mounted?.limbId, mounted?.html, slotId, instanceKey, route, contextKey, theme]);

  if (!mounted) {
    return (
      <amphibian-slot
        data-salamanda-slot={slotId}
        style={
          showSlotOutline
            ? {
                border: "1px dashed var(--studio-border)",
                borderRadius: "8px",
                padding: "8px 10px",
                fontSize: "11.5px",
                color: "var(--studio-muted)",
              }
            : undefined
        }
      >
        {showSlotOutline ? `Slot available: ${slotId}` : null}
      </amphibian-slot>
    );
  }

  return (
    <amphibian-slot data-salamanda-slot={slotId} data-salamanda-mounted="true">
      <div
        data-testid={`mounted-slot-${slotId}-${instanceKey}`}
        style={{
          position: "relative",
          borderRadius: "10px",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "4px",
            fontSize: "11px",
            color: "var(--studio-muted)",
          }}
        >
          <span>
            ✦ Mounted Limb: <strong>{mounted.limbId}</strong> ({slotId})
          </span>
          {instanceKey !== "default" ? <code>#{instanceKey.slice(0, 8)}</code> : null}
        </div>
        <iframe
          key={mountedKey}
          ref={iframeRef}
          title={`Limb ${mounted.limbId} in ${slotId}`}
          data-testid={`limb-iframe-${slotId}`}
          sandbox="allow-scripts allow-forms"
          srcDoc={mounted.html}
          onLoad={() => {
            broker.broadcastTheme(theme);
          }}
          style={{
            width: "100%",
            height: `${height}px`,
            border: "none",
            borderRadius: "10px",
            background: "transparent",
            display: "block",
          }}
        />
      </div>
    </amphibian-slot>
  );
}
