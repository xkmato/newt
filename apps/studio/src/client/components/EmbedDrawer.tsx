"use client";

import { useEffect, useRef, useState } from "react";
import type { BasePackDto, CompiledLimbBundle } from "../types";

interface HostInitPayload {
  baseId: string;
  manifestUrl?: string;
  hostOrigin?: string;
  route: string;
  availableSlots: string[];
  selectedSlot?: string;
  theme: "light" | "dark";
  cssVars?: Record<string, string>;
  userToken?: string | null;
}

export function EmbedDrawer(props: { initialBaseId: string }) {
  const portRef = useRef<MessagePort | null>(null);
  const [host, setHost] = useState<HostInitPayload>({
    baseId: props.initialBaseId || "xkmato",
    route: "/",
    availableSlots: [],
    theme: "light",
    userToken: null,
  });
  const [selectedSlot, setSelectedSlot] = useState<string>("");
  const [pickingSlot, setPickingSlot] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [status, setStatus] = useState<string>("Ready to build a Limb for this page.");
  const [busy, setBusy] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [compiled, setCompiled] = useState<CompiledLimbBundle | null>(null);
  const [basePack, setBasePack] = useState<BasePackDto | null>(null);
  const [activated, setActivated] = useState(false);
  const [unapprovedEgress, setUnapprovedEgress] = useState<string[]>([]);

  const ensureBaseRegistered = async (info: HostInitPayload): Promise<BasePackDto | null> => {
    const res = await fetch("/api/v1/bases");
    const data = (await res.json()) as { bases: BasePackDto[] };
    const existing = data.bases.find((b) => b.id === info.baseId);
    if (existing) {
      setBasePack(existing);
      return existing;
    }

    if (info.hostOrigin && info.manifestUrl) {
      const targetUrl = new URL(info.manifestUrl, info.hostOrigin).toString();
      const regRes = await fetch("/api/v1/bases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: targetUrl }),
      });
      if (regRes.ok) {
        const regBody = (await regRes.json()) as { base?: BasePackDto };
        if (regBody.base) {
          setBasePack(regBody.base);
          return regBody.base;
        }
      }
    }
    return null;
  };

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const msg = event.data as { protocol?: string; type?: string } | undefined;
      if (!msg || msg.protocol !== "newt.host.v1" || msg.type !== "newt.host.connect") return;
      const transferred = event.ports[0];
      if (!transferred) return;

      portRef.current?.close();
      portRef.current = transferred;
      transferred.onmessage = (portEv: MessageEvent) => {
        const data = portEv.data as Record<string, unknown> | undefined;
        if (!data || data.protocol !== "newt.host.v1") return;

        if (data.type === "newt.host.init") {
          const nextHost: HostInitPayload = {
            baseId: String(data.baseId ?? props.initialBaseId ?? "xkmato"),
            manifestUrl: typeof data.manifestUrl === "string" ? data.manifestUrl : undefined,
            hostOrigin: typeof data.hostOrigin === "string" ? data.hostOrigin : undefined,
            route: String(data.route ?? "/"),
            availableSlots: Array.isArray(data.availableSlots)
              ? (data.availableSlots as string[])
              : [],
            selectedSlot: typeof data.selectedSlot === "string" ? data.selectedSlot : undefined,
            theme: data.theme === "dark" ? "dark" : "light",
            userToken: typeof data.userToken === "string" ? data.userToken : null,
          };
          setHost(nextHost);
          if (nextHost.selectedSlot) {
            setSelectedSlot(nextHost.selectedSlot);
          } else if (nextHost.availableSlots[0]) {
            setSelectedSlot(nextHost.availableSlots[0]);
          }
          document.documentElement.classList.toggle("dark", nextHost.theme === "dark");
          void ensureBaseRegistered(nextHost);
        } else if (data.type === "newt.host.slot_picked") {
          setPickingSlot(false);
          const picked = String(data.slotId ?? "");
          if (picked) setSelectedSlot(picked);
          setStatus(`Selected slot '${picked}' on host page.`);
        } else if (data.type === "newt.host.route_changed") {
          setHost((prev) => ({
            ...prev,
            route: String(data.route ?? prev.route),
            availableSlots: Array.isArray(data.availableSlots)
              ? (data.availableSlots as string[])
              : prev.availableSlots,
          }));
        }
      };
      transferred.start();
    };

    window.addEventListener("message", onMessage);
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ protocol: "newt.host.v1", type: "newt.embed.ready" }, "*");
    }
    void ensureBaseRegistered(host);
    return () => {
      window.removeEventListener("message", onMessage);
      portRef.current?.close();
    };
  }, [props.initialBaseId]);

  const toggleSlotPicker = () => {
    const next = !pickingSlot;
    setPickingSlot(next);
    portRef.current?.postMessage({
      protocol: "newt.host.v1",
      type: next ? "newt.embed.enter_slot_picker" : "newt.embed.exit_slot_picker",
    });
  };

  const pushInlinePreview = (bundle: CompiledLimbBundle, pack: BasePackDto | null) => {
    const mount = bundle.manifest?.ui?.[0];
    if (!mount) return;
    const html = bundle.assets[mount.component];
    if (!html) return;
    const slotMeta = pack?.manifest.slots.find((s) => s.id === mount.slot);

    portRef.current?.postMessage({
      protocol: "newt.host.v1",
      type: "newt.embed.preview_inline",
      slotId: mount.slot,
      limbId: bundle.limbId,
      compiledHtml: html,
      cardinality: slotMeta?.cardinality ?? "singleton",
    });
  };

  const handleSynthesize = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setActivated(false);
    setUnapprovedEgress([]);
    setStatus("Registering host manifest & synthesizing Limb...");

    try {
      const pack = (await ensureBaseRegistered(host)) ?? basePack;
      let pid = projectId;
      if (!pid) {
        const createRes = await fetch("/api/v1/projects", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-newt-uid": "uid:kenneth",
          },
          body: JSON.stringify({
            name: `Embedded ${host.baseId} Limb`,
            mode: "salamanda-limb",
            baseTarget: host.baseId,
            slotId: selectedSlot || host.availableSlots[0] || undefined,
          }),
        });
        if (!createRes.ok) {
          throw new Error(await createRes.text());
        }
        const created = (await createRes.json()) as { project: { id: string } };
        pid = created.project.id;
        setProjectId(pid);
      }

      const chatRes = await fetch(`/api/v1/projects/${encodeURIComponent(pid)}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-newt-uid": "uid:kenneth",
        },
        body: JSON.stringify({
          prompt: prompt.trim(),
          selectedSlot: selectedSlot || host.availableSlots[0] || undefined,
        }),
      });

      const rawSse = await chatRes.text();
      let savedBundle: CompiledLimbBundle | null = null;
      for (const frame of rawSse.split("\n\n")) {
        if (!frame.includes("event: snapshot.saved")) continue;
        const dataLine = frame
          .split("\n")
          .find((l) => l.startsWith("data:"))
          ?.slice(5)
          .trim();
        if (dataLine) {
          const parsed = JSON.parse(dataLine) as {
            snapshot?: { compiledBundle?: CompiledLimbBundle | null };
          };
          savedBundle = parsed.snapshot?.compiledBundle ?? null;
        }
      }

      if (!savedBundle?.valid) {
        setStatus("Synthesis finished with compiler diagnostics.");
        return;
      }

      setCompiled(savedBundle);
      pushInlinePreview(savedBundle, pack);
      setStatus(
        `Previewing '${savedBundle.limbId}' inline in slot '${savedBundle.manifest?.ui?.[0]?.slot ?? selectedSlot}'.`
      );
    } catch (err) {
      setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleActivateOnSalamanda = async (approvedHosts: string[] = []) => {
    if (!projectId || busy) return;
    setBusy(true);
    setStatus("Deploying & binding Limb on Salamanda Control Plane...");
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "x-newt-uid": "uid:kenneth",
      };
      if (host.userToken && host.userToken.split(".").length === 3) {
        headers.Authorization = `Bearer ${host.userToken}`;
      }

      const res = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/deploy`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          bindToSelf: true,
          approvedEgressHosts: approvedHosts,
        }),
      });
      const body = (await res.json()) as {
        deployed?: boolean;
        limbId?: string;
        bindings?: string[];
        code?: string;
        unapprovedEgressHosts?: string[];
        error?: string;
      };

      if (res.status === 409 && body.code === "NEWT-CONSENT-001") {
        setUnapprovedEgress(body.unapprovedEgressHosts ?? []);
        setStatus("Human egress approval required before activating this Limb.");
        return;
      }
      if (!res.ok) {
        setStatus(`Activation failed: ${body.error ?? res.statusText}`);
        return;
      }

      setActivated(true);
      setUnapprovedEgress([]);
      setStatus(`Activated '${body.limbId}' on Salamanda. Safe to close or stop Newt.`);
      portRef.current?.postMessage({
        protocol: "newt.host.v1",
        type: "newt.embed.binding_updated",
        limbIds: body.bindings ?? [],
      });
    } catch (err) {
      setStatus(`Activation error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const closeDrawer = () => {
    portRef.current?.postMessage({
      protocol: "newt.host.v1",
      type: "newt.embed.close_drawer",
    });
  };

  const slotOptions = Array.from(
    new Set([
      ...host.availableSlots,
      ...(basePack?.manifest.slots.map((s) => s.id) ?? []),
    ])
  );

  return (
    <div
      data-testid="embed-drawer-root"
      style={{
        height: "100vh",
        display: "grid",
        gridTemplateRows: "auto 1fr auto",
        background: "var(--studio-panel)",
        color: "var(--studio-fg)",
      }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "12px 14px",
          borderBottom: "1px solid var(--studio-border)",
        }}
      >
        <div>
          <strong style={{ fontSize: "14px" }}>✦ Newt In-App Builder</strong>
          <div style={{ fontSize: "11.5px", color: "var(--studio-muted)" }}>
            Host: <code data-testid="embed-base-id">{host.baseId}</code> · Route: <code>{host.route}</code>
          </div>
        </div>
        <button type="button" className="studio-btn" onClick={closeDrawer}>
          Close
        </button>
      </header>

      <div style={{ padding: "14px", overflow: "auto", display: "grid", gap: "12px", alignContent: "start" }}>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <select
            aria-label="Target host slot"
            className="studio-select"
            data-testid="embed-slot-select"
            value={selectedSlot}
            onChange={(e) => setSelectedSlot(e.target.value)}
            style={{ flex: 1 }}
          >
            <option value="">Auto-select slot</option>
            {slotOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={`studio-btn ${pickingSlot ? "primary" : ""}`}
            data-testid="embed-pick-slot-btn"
            onClick={toggleSlotPicker}
          >
            {pickingSlot ? "Cancel Picker" : "Pick Slot"}
          </button>
        </div>

        <div
          role="status"
          data-testid="embed-status"
          style={{
            padding: "10px 12px",
            borderRadius: "8px",
            border: "1px solid var(--studio-border)",
            background: "var(--studio-bg)",
            fontSize: "12.5px",
          }}
        >
          {status}
        </div>

        {unapprovedEgress.length > 0 ? (
          <div
            role="alert"
            style={{
              padding: "12px",
              borderRadius: "8px",
              border: "1px solid #d97706",
              display: "grid",
              gap: "8px",
              fontSize: "12.5px",
            }}
          >
            <strong>NEWT-CONSENT-001 — Approve External Egress:</strong>
            <code>{unapprovedEgress.join(", ")}</code>
            <button
              type="button"
              className="studio-btn primary"
              onClick={() => void handleActivateOnSalamanda(unapprovedEgress)}
            >
              Confirm Egress &amp; Activate
            </button>
          </div>
        ) : null}

        {compiled?.valid ? (
          <div
            style={{
              padding: "12px",
              borderRadius: "10px",
              border: "1px solid var(--studio-border)",
              background: "var(--studio-surface)",
              display: "grid",
              gap: "8px",
              fontSize: "12.5px",
            }}
          >
            <div>
              <strong>{compiled.manifest?.limb.name ?? compiled.limbId}</strong>{" "}
              <span className="studio-badge" data-state="valid">
                L{compiled.manifest?.limb.level ?? 1} · Compiled ✓
              </span>
            </div>
            <div style={{ color: "var(--studio-muted)" }}>
              Slot: <code>{compiled.manifest?.ui?.[0]?.slot}</code> · Sidecar:{" "}
              <code>{compiled.manifest?.permissions.sidecar ?? "none"}</code>
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                type="button"
                className="studio-btn"
                data-testid="embed-repreview-btn"
                onClick={() => pushInlinePreview(compiled, basePack)}
              >
                Preview Inline
              </button>
              <button
                type="button"
                className="studio-btn primary"
                data-testid="embed-activate-btn"
                disabled={busy}
                onClick={() => void handleActivateOnSalamanda()}
              >
                {activated ? "Activated on Salamanda ✓" : "Activate on Salamanda"}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <form
        onSubmit={handleSynthesize}
        style={{
          padding: "12px 14px",
          borderTop: "1px solid var(--studio-border)",
          display: "grid",
          gap: "8px",
        }}
      >
        <textarea
          aria-label="Describe the Limb to build"
          data-testid="embed-prompt-input"
          rows={3}
          className="studio-input"
          placeholder="Prompt a custom UI or feature for this page..."
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          style={{ resize: "none", fontFamily: "inherit" }}
        />
        <button
          type="submit"
          className="studio-btn primary"
          data-testid="embed-synthesize-btn"
          disabled={busy || !prompt.trim()}
        >
          {busy ? "Synthesizing..." : "Build & Preview Inline ↵"}
        </button>
      </form>
    </div>
  );
}
