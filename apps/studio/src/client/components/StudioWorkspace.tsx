"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BrowserSalamandaHostBroker } from "../browser-broker";
import type {
  BasePackDto,
  HealthDto,
  ProjectDetailDto,
  ProjectMode,
  ProjectRecord,
  TraceItem,
} from "../types";
import { BaseShellSimulator } from "./BaseShellSimulator";
import { CodeDiffEditor } from "./CodeDiffEditor";
import { ContractInspector } from "./ContractInspector";
import { SidecarExplorer } from "./SidecarExplorer";
import { type ResolvedTheme, ThemeToggle } from "./ThemeToggle";

type WorkbenchTab = "preview" | "code" | "sidecar" | "contract";

const STARTER_PROMPTS: Record<string, Array<{ label: string; prompt: string; slot?: string }>> = {
  xkmato: [
    {
      label: "Blog Sidebar Margin Notes (SQLite)",
      prompt: "Build a personal margin notes widget for blog.sidebar using a SQLite sidecar table",
      slot: "blog.sidebar",
    },
    {
      label: "Micropost Bookmark Bar (Repeater)",
      prompt: "Add a compact bookmark counter bar inside each micropost.footer repeater card",
      slot: "micropost.footer",
    },
    {
      label: "Article Audio Companion (Header)",
      prompt: "Build an audio player companion bar in blog.header with play and pause controls",
      slot: "blog.header",
    },
  ],
  standalone: [
    {
      label: "Focus Timer & Tasks Widget",
      prompt: "Build a standalone Pomodoro focus timer and checklist widget with clean dark mode support",
      slot: "standalone.canvas",
    },
    {
      label: "Interactive Counter & List",
      prompt: "Create a standalone interactive counter and quick notes widget",
      slot: "standalone.canvas",
    },
  ],
};

export function StudioWorkspace() {
  const broker = useMemo(() => new BrowserSalamandaHostBroker(), []);
  const [health, setHealth] = useState<HealthDto | null>(null);
  const [bases, setBases] = useState<BasePackDto[]>([]);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProjectDetailDto | null>(null);
  const [tab, setTab] = useState<WorkbenchTab>("preview");
  const [theme, setTheme] = useState<ResolvedTheme>("light");
  const [activeRoute, setActiveRoute] = useState<string>("/blog/launching-amphibian");
  const [selectedSlot, setSelectedSlot] = useState<string>("");
  const [promptInput, setPromptInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [savingFile, setSavingFile] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [deployBanner, setDeployBanner] = useState<{
    kind: "ok" | "error" | "consent";
    message: string;
    unapprovedHosts?: string[];
  } | null>(null);
  const [approvedEgressHosts, setApprovedEgressHosts] = useState<string[]>([]);
  const [traces, setTraces] = useState<TraceItem[]>([]);
  const [statusError, setStatusError] = useState<string | null>(null);

  // New project form
  const [showNewModal, setShowNewModal] = useState(false);
  const [newProjName, setNewProjName] = useState("");
  const [newProjMode, setNewProjMode] = useState<ProjectMode>("salamanda-limb");
  const [newProjBase, setNewProjBase] = useState("xkmato");
  const [inspectUrl, setInspectUrl] = useState("");
  const [inspectingUrl, setInspectingUrl] = useState(false);

  const activeBase = useMemo(() => {
    const targetId = detail?.project.baseTarget ?? newProjBase ?? "xkmato";
    return bases.find((b) => b.id === targetId) ?? bases[0] ?? null;
  }, [bases, detail?.project.baseTarget, newProjBase]);

  const activeBundle = detail?.currentSnapshot?.compiledBundle ?? null;
  const activeFiles = detail?.currentSnapshot?.files ?? {};

  const lastSnapshotIdRef = useRef<number | null>(null);

  useEffect(() => {
    broker.start();
    return () => broker.stop();
  }, [broker]);

  const handleThemeChange = useCallback(
    (nextTheme: ResolvedTheme) => {
      setTheme(nextTheme);
      broker.broadcastTheme(nextTheme);
    },
    [broker]
  );

  // Sync active compiled Limb & SQLite sidecar into the in-browser broker
  useEffect(() => {
    if (!activeBase) return;
    const snapId = detail?.currentSnapshot?.id ?? null;
    const isNewSnapshot = snapId !== lastSnapshotIdRef.current;
    lastSnapshotIdRef.current = snapId;

    void broker.configureActiveLimb({
      base: activeBase,
      bundle: activeBundle,
      vfs: activeFiles,
      resetSidecar: isNewSnapshot,
    });
  }, [broker, activeBase, activeBundle, activeFiles, detail?.currentSnapshot?.id]);

  // Auto-align simulator route with the active Limb's primary slot
  useEffect(() => {
    const firstMount = activeBundle?.manifest?.ui?.[0];
    if (!firstMount || !activeBase) return;
    if (activeBase.id === "xkmato") {
      if (firstMount.slot === "micropost.footer" || firstMount.slot.startsWith("feed.")) {
        setActiveRoute("/feed");
      } else if (firstMount.slot === "blog.list.header") {
        setActiveRoute("/blog");
      } else if (firstMount.slot === "home.hero.after") {
        setActiveRoute("/");
      } else if (firstMount.slot.startsWith("blog.")) {
        setActiveRoute("/blog/launching-amphibian");
      }
    }
  }, [activeBundle?.limbId, activeBundle?.manifest?.ui?.[0]?.slot, activeBase?.id]);

  const loadProjectDetail = useCallback(async (projectId: string) => {
    const res = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}`);
    if (!res.ok) return;
    const data = (await res.json()) as ProjectDetailDto;
    setDetail(data);
    setActiveProjectId(projectId);
  }, []);

  const bootstrap = useCallback(async () => {
    try {
      const [hRes, bRes, pRes] = await Promise.all([
        fetch("/api/v1/health"),
        fetch("/api/v1/bases"),
        fetch("/api/v1/projects"),
      ]);
      const h = (await hRes.json()) as HealthDto;
      const b = (await bRes.json()) as { bases: BasePackDto[] };
      const p = (await pRes.json()) as { projects: ProjectRecord[] };

      setHealth(h);
      setBases(b.bases);
      setProjects(p.projects);

      if (p.projects.length > 0) {
        await loadProjectDetail(p.projects[0]!.id);
      } else {
        // Seed a clean default XKmato workspace project on first launch
        const createRes = await fetch("/api/v1/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "XKmato Reading Companion",
            mode: "salamanda-limb",
            baseTarget: "xkmato",
            slotId: "blog.sidebar",
          }),
        });
        if (createRes.ok) {
          const created = (await createRes.json()) as { project: ProjectRecord };
          setProjects([created.project]);
          await loadProjectDetail(created.project.id);
        }
      }
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : String(err));
    }
  }, [loadProjectDetail]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  const createNewProject = async (opts?: {
    name?: string;
    mode?: ProjectMode;
    baseTarget?: string;
  }) => {
    const mode = opts?.mode ?? newProjMode;
    const baseTarget = opts?.baseTarget ?? (mode === "standalone-ui" ? "standalone" : newProjBase);
    const name =
      (opts?.name ?? newProjName).trim() ||
      (mode === "standalone-ui" ? "Standalone UI Widget" : `New ${baseTarget} Limb`);

    setStatusError(null);
    const res = await fetch("/api/v1/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, mode, baseTarget }),
    });
    if (!res.ok) {
      const err = (await res.json()) as { error?: string };
      setStatusError(err.error ?? "Failed to create project");
      return null;
    }
    const created = (await res.json()) as { project: ProjectRecord };
    setProjects((prev) => [created.project, ...prev]);
    setShowNewModal(false);
    setNewProjName("");
    setTraces([]);
    await loadProjectDetail(created.project.id);
    return created.project;
  };

  const handleInspectUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inspectUrl.trim()) return;
    setInspectingUrl(true);
    setStatusError(null);
    try {
      const res = await fetch("/api/v1/bases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: inspectUrl.trim() }),
      });
      const body = (await res.json()) as { base?: BasePackDto; error?: string };
      if (!res.ok || !body.base) {
        setStatusError(body.error ?? "Failed to inspect URL");
        return;
      }
      setBases((prev) => [...prev.filter((b) => b.id !== body.base!.id), body.base!]);
      setNewProjBase(body.base.id);
      setNewProjMode("salamanda-limb");
      setInspectUrl("");
    } finally {
      setInspectingUrl(false);
    }
  };

  const sendPrompt = async (overridePrompt?: string, overrideSlot?: string) => {
    const prompt = (overridePrompt ?? promptInput).trim();
    if (!prompt || !activeProjectId || streaming) return;

    setStreaming(true);
    setStatusError(null);
    if (!overridePrompt) setPromptInput("");

    const pushTrace = (
      event: string,
      summary: string,
      status: TraceItem["status"] = "info"
    ) => {
      setTraces((prev) => [
        ...prev,
        {
          id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          event,
          summary,
          status,
          timestamp: Date.now(),
        },
      ]);
    };

    pushTrace("user.prompt", prompt, "info");

    try {
      const res = await fetch(`/api/v1/projects/${encodeURIComponent(activeProjectId)}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          selectedSlot: overrideSlot || selectedSlot || undefined,
        }),
      });

      if (!res.ok || !res.body) {
        const text = await res.text();
        setStatusError(text || "Chat request failed");
        pushTrace("turn.error", text || "Chat request failed", "error");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let splitIdx = buffer.indexOf("\n\n");
        while (splitIdx !== -1) {
          const frame = buffer.slice(0, splitIdx).trim();
          buffer = buffer.slice(splitIdx + 2);
          splitIdx = buffer.indexOf("\n\n");

          if (!frame) continue;
          let eventName = "message";
          let dataLine = "";
          for (const line of frame.split("\n")) {
            if (line.startsWith("event:")) eventName = line.slice(6).trim();
            else if (line.startsWith("data:")) dataLine += line.slice(5).trim();
          }
          if (!dataLine) continue;

          const data = JSON.parse(dataLine) as Record<string, unknown>;
          if (eventName === "gatekeeper.passed") {
            pushTrace(eventName, "Gatekeeper passed prompt safety check", "ok");
          } else if (eventName === "gatekeeper.blocked") {
            pushTrace(eventName, `Blocked (${String(data.code)}): ${String(data.reason)}`, "error");
          } else if (eventName === "blueprint.ready") {
            const bp = data.blueprint as { displayName?: string; level?: number; uiMounts?: Array<{ slot: string }> };
            pushTrace(
              eventName,
              `Architect planned "${bp.displayName}" (L${bp.level}, slot: ${bp.uiMounts?.[0]?.slot ?? "?"})`,
              "ok"
            );
          } else if (eventName === "synthesis.started") {
            pushTrace(eventName, `Parallel synthesis: ${(data.agents as string[]).join(" + ")}`, "info");
          } else if (eventName === "vfs.updated") {
            pushTrace(eventName, `Updated ${(data.paths as string[]).join(", ")}`, "info");
          } else if (eventName === "compile.result") {
            const valid = Boolean(data.valid);
            const diagCount = Array.isArray(data.diagnostics) ? data.diagnostics.length : 0;
            pushTrace(
              eventName,
              valid ? "6-stage compiler passed (0 errors)" : `Compiler reported ${diagCount} diagnostic(s)`,
              valid ? "ok" : "warn"
            );
          } else if (eventName === "repair.attempt") {
            pushTrace(
              eventName,
              `RepairAgent attempt ${String(data.attempt)}/${String(data.maxAttempts)}`,
              "warn"
            );
          } else if (eventName === "snapshot.saved") {
            pushTrace(
              eventName,
              `Saved checkpoint #${String((data.snapshot as { id?: number } | null)?.id ?? "-")}`,
              data.ok ? "ok" : "warn"
            );
            await loadProjectDetail(activeProjectId);
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusError(msg);
      pushTrace("turn.error", msg, "error");
    } finally {
      setStreaming(false);
    }
  };

  const handleSaveFile = async (filePath: string, content: string) => {
    if (!activeProjectId) return;
    setSavingFile(true);
    try {
      const res = await fetch(`/api/v1/projects/${encodeURIComponent(activeProjectId)}/files`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patch: { [filePath]: content },
          summary: `Edited ${filePath}`,
        }),
      });
      if (res.ok) {
        await loadProjectDetail(activeProjectId);
      }
    } finally {
      setSavingFile(false);
    }
  };

  const handleRollback = async (snapshotId: number) => {
    if (!activeProjectId) return;
    const res = await fetch(`/api/v1/projects/${encodeURIComponent(activeProjectId)}/rollback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ snapshotId }),
    });
    if (res.ok) {
      await loadProjectDetail(activeProjectId);
    }
  };

  const handleDeployToSalamanda = async (explicitHosts?: string[]) => {
    if (!activeProjectId || deploying) return;
    setDeploying(true);
    setDeployBanner(null);
    const hosts = Array.from(new Set([...approvedEgressHosts, ...(explicitHosts ?? [])]));
    try {
      const res = await fetch(`/api/v1/projects/${encodeURIComponent(activeProjectId)}/deploy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvedEgressHosts: hosts, bindToSelf: true }),
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
        setDeployBanner({
          kind: "consent",
          message: body.error ?? "Human egress consent required before binding external hosts.",
          unapprovedHosts: body.unapprovedEgressHosts ?? [],
        });
        setTab("contract");
        return;
      }
      if (!res.ok) {
        setDeployBanner({ kind: "error", message: body.error ?? "Deploy to Salamanda failed" });
        return;
      }
      setDeployBanner({
        kind: "ok",
        message: `Deployed & bound '${body.limbId}' on Salamanda (active: ${(body.bindings ?? []).join(", ")})`,
      });
    } catch (err) {
      setDeployBanner({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setDeploying(false);
    }
  };

  const handleApproveEgress = (hosts: string[]) => {
    const merged = Array.from(new Set([...approvedEgressHosts, ...hosts]));
    setApprovedEgressHosts(merged);
    void handleDeployToSalamanda(merged);
  };

  const quickPrompts = STARTER_PROMPTS[activeBase?.id ?? "xkmato"] ?? STARTER_PROMPTS.standalone ?? [];

  return (
    <div className="studio-shell">
      <header className="studio-header">
        <div className="studio-brand">
          <span style={{ color: "var(--studio-accent)", fontSize: "18px" }}>✦</span>
          <span>Newt Studio</span>
          <span className="studio-badge">
            {health ? `${health.provider.name} · ${health.provider.model}` : "connecting..."}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <select
            aria-label="Active project"
            className="studio-select"
            data-testid="project-selector"
            value={activeProjectId ?? ""}
            onChange={(e) => void loadProjectDetail(e.target.value)}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.baseTarget})
              </option>
            ))}
          </select>

          <a
            href="/gallery"
            className="studio-btn"
            style={{ textDecoration: "none" }}
          >
            Gallery
          </a>

          <button
            type="button"
            className="studio-btn"
            data-testid="new-project-btn"
            onClick={() => setShowNewModal((v) => !v)}
          >
            + New Project
          </button>

          <span
            className="studio-badge"
            data-testid="compile-status-badge"
            data-state={activeBundle ? (activeBundle.valid ? "valid" : "error") : "warn"}
          >
            {activeBundle
              ? activeBundle.valid
                ? "Compiled ✓"
                : `${activeBundle.diagnostics.filter((d) => d.severity === "error").length} Errors`
              : "Uncompiled"}
          </span>

          <button
            type="button"
            className="studio-btn primary"
            data-testid="deploy-salamanda-btn"
            disabled={deploying || !activeBundle?.valid || activeBase?.id === "standalone"}
            title={
              activeBase?.id === "standalone"
                ? "Switch to a host base target (e.g. xkmato) to deploy to Salamanda"
                : "Upload & bind Limb on the configured Salamanda Control Plane"
            }
            onClick={() => void handleDeployToSalamanda()}
          >
            {deploying ? "Deploying..." : "Deploy to Salamanda"}
          </button>

          <ThemeToggle onThemeChange={handleThemeChange} />
        </div>
      </header>

      {showNewModal ? (
        <section
          aria-label="Create new project"
          data-testid="new-project-panel"
          style={{
            position: "fixed",
            top: "64px",
            right: "16px",
            zIndex: 30,
            width: "360px",
            padding: "16px",
            borderRadius: "12px",
            border: "1px solid var(--studio-border)",
            background: "var(--studio-panel)",
            boxShadow: "0 12px 32px rgb(0 0 0 / 20%)",
            display: "grid",
            gap: "12px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <strong style={{ fontSize: "14px" }}>New Project / Base Target</strong>
            <button type="button" className="studio-btn" onClick={() => setShowNewModal(false)}>
              Close
            </button>
          </div>

          <label style={{ display: "grid", gap: "4px", fontSize: "12px" }}>
            <span>Project Name</span>
            <input
              type="text"
              className="studio-input"
              data-testid="new-project-name"
              placeholder="e.g. Pomodoro Widget or Margin Notes"
              value={newProjName}
              onChange={(e) => setNewProjName(e.target.value)}
            />
          </label>

          <label style={{ display: "grid", gap: "4px", fontSize: "12px" }}>
            <span>Authoring Mode</span>
            <select
              className="studio-select"
              data-testid="new-project-mode"
              value={newProjMode}
              onChange={(e) => {
                const nextMode = e.target.value as ProjectMode;
                setNewProjMode(nextMode);
                if (nextMode === "standalone-ui") setNewProjBase("standalone");
                else if (newProjBase === "standalone") setNewProjBase("xkmato");
              }}
            >
              <option value="salamanda-limb">Salamanda Limb (Pluggable Host Base)</option>
              <option value="standalone-ui">Standalone UI Component (No Base Required)</option>
            </select>
          </label>

          {newProjMode === "salamanda-limb" ? (
            <label style={{ display: "grid", gap: "4px", fontSize: "12px" }}>
              <span>Target Base Pack</span>
              <select
                className="studio-select"
                data-testid="new-project-base"
                value={newProjBase}
                onChange={(e) => setNewProjBase(e.target.value)}
              >
                {bases
                  .filter((b) => b.id !== "standalone")
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.manifest.base.name} ({b.id})
                    </option>
                  ))}
              </select>
            </label>
          ) : null}

          <button
            type="button"
            className="studio-btn primary"
            data-testid="create-project-submit"
            onClick={() => void createNewProject()}
          >
            Create Project
          </button>

          <hr style={{ border: "none", borderTop: "1px solid var(--studio-border)", margin: "4px 0" }} />

          <form onSubmit={handleInspectUrl} style={{ display: "grid", gap: "6px" }}>
            <span style={{ fontSize: "11.5px", color: "var(--studio-muted)" }}>
              Or bootstrap a Base Pack from any live URL:
            </span>
            <div style={{ display: "flex", gap: "6px" }}>
              <input
                type="url"
                className="studio-input"
                placeholder="https://example.com"
                value={inspectUrl}
                onChange={(e) => setInspectUrl(e.target.value)}
                style={{ flex: 1 }}
              />
              <button type="submit" className="studio-btn" disabled={inspectingUrl}>
                {inspectingUrl ? "..." : "Inspect"}
              </button>
            </div>
          </form>
        </section>
      ) : null}

      <main className="studio-main">
        {/* Left Pane: Agent Chat, Live SSE Trace & Checkpoints */}
        <section className="studio-sidebar" aria-label="Agent chat and trace">
          <div
            style={{
              padding: "10px 12px",
              borderBottom: "1px solid var(--studio-border)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <strong style={{ fontSize: "13px" }}>Agent Studio</strong>
            {activeBase ? (
              <select
                aria-label="Target slot override"
                className="studio-select"
                data-testid="slot-selector"
                value={selectedSlot}
                onChange={(e) => setSelectedSlot(e.target.value)}
              >
                <option value="">Auto-pick slot ({activeBase.id})</option>
                {activeBase.manifest.slots.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.id} ({s.cardinality})
                  </option>
                ))}
              </select>
            ) : null}
          </div>

          <div style={{ flex: 1, overflow: "auto", padding: "12px", display: "grid", gap: "10px", alignContent: "start" }}>
            {statusError ? (
              <div
                role="alert"
                style={{
                  padding: "8px 10px",
                  borderRadius: "8px",
                  border: "1px solid #ef4444",
                  color: "#ef4444",
                  fontSize: "12px",
                }}
              >
                {statusError}
              </div>
            ) : null}

            <div style={{ display: "grid", gap: "6px" }}>
              <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--studio-muted)" }}>
                QUICK STARTERS ({activeBase?.manifest.base.name ?? "Base"})
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                {quickPrompts.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    className="studio-btn"
                    disabled={streaming}
                    onClick={() => void sendPrompt(item.prompt, item.slot)}
                    style={{ fontSize: "11.5px", padding: "4px 9px" }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: "grid", gap: "6px" }} data-testid="agent-trace-list">
              <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--studio-muted)" }}>
                LIVE SSE TRACE
              </div>
              {traces.length === 0 ? (
                <p style={{ margin: 0, fontSize: "12px", color: "var(--studio-muted)" }}>
                  Prompt Newt to synthesize a standalone UI component or a platform Limb with SQLite sidecars.
                </p>
              ) : (
                traces.map((t) => (
                  <div
                    key={t.id}
                    style={{
                      padding: "7px 9px",
                      borderRadius: "8px",
                      border: "1px solid var(--studio-border)",
                      background: "var(--studio-bg)",
                      fontSize: "12px",
                    }}
                  >
                    <div
                      style={{
                        fontSize: "10.5px",
                        fontWeight: 700,
                        color:
                          t.status === "ok"
                            ? "#16a34a"
                            : t.status === "error"
                              ? "#ef4444"
                              : t.status === "warn"
                                ? "#d97706"
                                : "var(--studio-muted)",
                      }}
                    >
                      {t.event}
                    </div>
                    <div style={{ marginTop: "2px" }}>{t.summary}</div>
                  </div>
                ))
              )}
            </div>

            {detail && detail.snapshots.length > 0 ? (
              <div style={{ display: "grid", gap: "6px" }} data-testid="checkpoint-list">
                <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--studio-muted)" }}>
                  VFS CHECKPOINTS ({detail.snapshots.length})
                </div>
                {detail.snapshots.slice(0, 6).map((snap) => {
                  const isCurrent = snap.id === detail.project.currentSnapshotId;
                  return (
                    <div
                      key={snap.id}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: "8px",
                        padding: "6px 8px",
                        borderRadius: "8px",
                        border: "1px solid var(--studio-border)",
                        background: isCurrent ? "var(--studio-surface)" : "transparent",
                        fontSize: "11.5px",
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <strong>#{snap.id}</strong>{" "}
                        <span style={{ color: "var(--studio-muted)" }}>{snap.summary}</span>
                      </div>
                      {!isCurrent ? (
                        <button
                          type="button"
                          className="studio-btn"
                          style={{ padding: "3px 7px", fontSize: "11px" }}
                          onClick={() => void handleRollback(snap.id)}
                        >
                          Restore
                        </button>
                      ) : (
                        <span className="studio-badge">Active</span>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void sendPrompt();
            }}
            style={{
              padding: "10px 12px",
              borderTop: "1px solid var(--studio-border)",
              display: "grid",
              gap: "8px",
            }}
          >
            <textarea
              aria-label="Prompt Newt Agent"
              data-testid="chat-prompt-input"
              rows={3}
              className="studio-input"
              placeholder="Describe the UI widget or Limb to build..."
              value={promptInput}
              onChange={(e) => setPromptInput(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  void sendPrompt();
                }
              }}
              style={{ resize: "none", fontFamily: "inherit" }}
            />
            <button
              type="submit"
              className="studio-btn primary"
              data-testid="chat-send-btn"
              disabled={streaming || !promptInput.trim()}
            >
              {streaming ? "Synthesizing & Compiling..." : "Synthesize Limb ↵"}
            </button>
          </form>
        </section>

        {/* Right Pane: Tabbed Workbench */}
        <section className="studio-workbench" aria-label="Studio workbench">
          <div className="studio-tabs">
            <div className="studio-tablist" role="tablist" aria-label="Workbench views">
              {(
                [
                  { id: "preview", label: "Preview Simulator" },
                  { id: "code", label: "Code & Diff" },
                  { id: "sidecar", label: "SQLite Sidecar" },
                  { id: "contract", label: "Contract & Security" },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === item.id}
                  data-testid={`tab-${item.id}`}
                  className="studio-tab"
                  onClick={() => setTab(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            {activeBase ? (
              <span className="studio-badge">
                Base: {activeBase.id} · Mode: {detail?.project.mode ?? "salamanda-limb"}
              </span>
            ) : null}
          </div>

          <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
            {tab === "preview" && activeBase ? (
              <BaseShellSimulator
                base={activeBase}
                bundle={activeBundle}
                broker={broker}
                theme={theme}
                activeRoute={activeRoute}
                onRouteChange={setActiveRoute}
              />
            ) : null}

            {tab === "code" ? (
              <CodeDiffEditor
                files={activeFiles}
                diff={detail?.diff ?? []}
                compiled={activeBundle}
                saving={savingFile}
                onSaveFile={handleSaveFile}
              />
            ) : null}

            {tab === "sidecar" ? <SidecarExplorer broker={broker} /> : null}

            {tab === "contract" ? (
              <>
                {deployBanner ? (
                  <div
                    role="status"
                    style={{
                      margin: "16px 16px 0",
                      padding: "10px 12px",
                      borderRadius: "8px",
                      border: "1px solid var(--studio-border)",
                      fontSize: "12.5px",
                      color:
                        deployBanner.kind === "error"
                          ? "#ef4444"
                          : deployBanner.kind === "ok"
                            ? "#16a34a"
                            : "#d97706",
                    }}
                  >
                    {deployBanner.message}
                  </div>
                ) : null}
                <ContractInspector compiled={activeBundle} onApproveEgress={handleApproveEgress} />
              </>
            ) : null}
          </div>
        </section>
      </main>
    </div>
  );
}
