"use client";

import { useEffect, useState } from "react";
import type { CompiledLimbBundle } from "../types";

interface VariantProgressStep {
  stage: string;
  variantId?: string;
  message: string;
  timestamp: number;
  port?: number;
  cacheHit?: boolean;
  conflictReason?: string;
  fallbackToVanilla?: boolean;
}

interface ManagedVariantDto {
  variantId: string;
  baseRepoDir: string;
  baseCommit: string;
  patchDiff: string;
  patchDigest: string;
  touches: string[];
  worktreePath: string;
  state: string;
  port: number | null;
  fallbackToVanilla: boolean;
  conflictReason: string | null;
  metrics: {
    worktreeMaterializeMs: number;
    patchApplyMs: number;
    cacheHit: boolean;
  };
  history: VariantProgressStep[];
}

export function VariantWorkbench(props: {
  projectId: string | null;
  compiled: CompiledLimbBundle | null;
  l3Enabled: boolean;
  onProjectUpdated: () => Promise<void>;
}) {
  const { projectId, compiled, l3Enabled, onProjectUpdated } = props;
  const [baseRepoDir, setBaseRepoDir] = useState("");
  const [variant, setVariant] = useState<ManagedVariantDto | null>(null);
  const [steps, setSteps] = useState<VariantProgressStep[]>([]);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const patch = compiled?.variantPatch ?? null;

  useEffect(() => {
    if (!projectId) return;
    fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/variant`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { variant?: ManagedVariantDto | null } | null) => {
        if (body?.variant) {
          setVariant(body.variant);
          setSteps(body.variant.history ?? []);
          if (!baseRepoDir) setBaseRepoDir(body.variant.baseRepoDir);
        } else {
          setVariant(null);
          setSteps([]);
        }
      })
      .catch(() => {});
  }, [projectId, patch?.digest]);

  const handleMaterialize = async () => {
    if (!projectId || busy) return;
    setBusy(true);
    setErrorMsg(null);
    setSteps([]);

    try {
      const res = await fetch(
        `/api/v1/projects/${encodeURIComponent(projectId)}/variant/materialize`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(baseRepoDir.trim() ? { baseRepoDir: baseRepoDir.trim() } : {}),
        }
      );

      if (!res.ok || !res.body) {
        const text = await res.text();
        setErrorMsg(text || "Failed to materialize Level 3 variant");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let idx = buffer.indexOf("\n\n");
        while (idx !== -1) {
          const frame = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 2);
          idx = buffer.indexOf("\n\n");
          if (!frame) continue;

          let evName = "message";
          let dataLine = "";
          for (const line of frame.split("\n")) {
            if (line.startsWith("event:")) evName = line.slice(6).trim();
            else if (line.startsWith("data:")) dataLine += line.slice(5).trim();
          }
          if (!dataLine) continue;
          const payload = JSON.parse(dataLine) as Record<string, unknown>;

          if (evName === "variant.progress") {
            setSteps((prev) => [...prev, payload as unknown as VariantProgressStep]);
          } else if (evName === "variant.ready") {
            setVariant(payload as unknown as ManagedVariantDto);
          } else if (evName === "variant.error") {
            setErrorMsg(String(payload.error ?? "Materialization error"));
          }
        }
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleRebase = async (autoRepair: boolean) => {
    if (!projectId || busy) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await fetch(
        `/api/v1/projects/${encodeURIComponent(projectId)}/variant/rebase`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ newCommit: "HEAD", autoRepair }),
        }
      );
      const body = (await res.json()) as {
        variant?: ManagedVariantDto;
        repaired?: boolean;
        error?: string;
      };
      if (body.variant) {
        setVariant(body.variant);
        setSteps(body.variant.history ?? []);
      }
      if (!res.ok && body.error) {
        setErrorMsg(body.error);
      }
      if (body.repaired) {
        await onProjectUpdated();
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!l3Enabled && !patch) {
    return (
      <div style={{ padding: "20px", fontSize: "13px", color: "var(--studio-muted)" }}>
        Level 3 Full-Source Variant Authoring is gated off. Set{" "}
        <code>NEWT_ENABLE_L3_VARIANTS=1</code> when the target base advertises <code>3</code> in{" "}
        <code>allow_levels</code>.
      </div>
    );
  }

  return (
    <div style={{ padding: "16px", display: "grid", gap: "16px" }} data-testid="variant-workbench">
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "15.5px" }}>
            Level 3 Variant — Patch Diff Review &amp; Worktree Runtime
          </h2>
          <p style={{ margin: "2px 0 0", fontSize: "12px", color: "var(--studio-muted)" }}>
            Pre-flight <code>SAL-EDIT-001</code> verified unified git diffs, async worktree materialization, and rebase conflict self-repair.
          </p>
        </div>
        <span
          className="studio-badge"
          data-testid="variant-state-badge"
          data-state={
            variant?.state === "Running"
              ? "valid"
              : variant?.state === "Stale" || variant?.state === "Failed"
                ? "error"
                : "warn"
          }
        >
          State: {variant?.state ?? (patch ? "Defined" : "No L3 Patch")}
        </span>
      </header>

      {errorMsg ? (
        <div
          role="alert"
          style={{
            padding: "10px 12px",
            borderRadius: "8px",
            border: "1px solid #ef4444",
            color: "#ef4444",
            fontSize: "12.5px",
          }}
        >
          {errorMsg}
        </div>
      ) : null}

      {/* Rebase Conflict Resolution Alert (Stale -> Graceful Fallback + 1-Click Self-Repair) */}
      {variant?.state === "Stale" ? (
        <section
          role="alert"
          data-testid="rebase-conflict-banner"
          style={{
            padding: "14px",
            borderRadius: "10px",
            border: "1px solid #d97706",
            background: "color-mix(in oklab, #d97706 10%, var(--studio-panel))",
            display: "grid",
            gap: "10px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <strong style={{ fontSize: "13.5px" }}>
              ⚠ Upstream Rebase Conflict — Variant Marked Stale (Gracefully Falling Back to Vanilla Base)
            </strong>
            <button
              type="button"
              className="studio-btn primary"
              data-testid="variant-self-repair-btn"
              disabled={busy}
              onClick={() => void handleRebase(true)}
            >
              {busy ? "Self-Repairing..." : "✦ AI Self-Repair & Re-Materialize"}
            </button>
          </div>
          <pre
            style={{
              margin: 0,
              padding: "10px",
              borderRadius: "8px",
              background: "var(--studio-bg)",
              border: "1px solid var(--studio-border)",
              fontSize: "11.5px",
              overflow: "auto",
            }}
          >
            {variant.conflictReason ?? "git apply conflict against updated upstream commit"}
          </pre>
        </section>
      ) : null}

      {/* Patch Diff Review Card */}
      {patch ? (
        <section
          data-testid="patch-diff-review"
          style={{
            border: "1px solid var(--studio-border)",
            borderRadius: "10px",
            background: "var(--studio-panel)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "10px 14px",
              borderBottom: "1px solid var(--studio-border)",
              background: "var(--studio-surface)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "8px",
              fontSize: "12px",
            }}
          >
            <div>
              <strong>{patch.diffFile}</strong> ·{" "}
              <code data-testid="patch-digest">{patch.digest.slice(0, 23)}…</code>
            </div>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              {patch.touches.map((file) => (
                <span key={file} className="studio-badge" data-state="valid">
                  SAL-EDIT-001 ✓ {file}
                </span>
              ))}
            </div>
          </div>
          <pre
            style={{
              margin: 0,
              padding: "12px 14px",
              overflow: "auto",
              fontSize: "12px",
              lineHeight: 1.55,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            }}
          >
            {patch.diff.split("\n").map((line, i) => {
              const color = line.startsWith("+") && !line.startsWith("+++")
                ? "#16a34a"
                : line.startsWith("-") && !line.startsWith("---")
                  ? "#ef4444"
                  : line.startsWith("@@")
                    ? "var(--studio-accent)"
                    : "inherit";
              return (
                <div key={i} style={{ color }}>
                  {line || " "}
                </div>
              );
            })}
          </pre>
        </section>
      ) : (
        <div
          style={{
            padding: "18px",
            borderRadius: "10px",
            border: "1px dashed var(--studio-border)",
            fontSize: "13px",
            color: "var(--studio-muted)",
          }}
        >
          Prompt the agent for a Level 3 layout or source patch (e.g.{" "}
          <em>"Create a Level 3 layout patch updating the base header"</em>) to generate{" "}
          <code>patches/variant.patch</code>.
        </div>
      )}

      {/* Materialization & Rebase Controls */}
      {patch ? (
        <section
          style={{
            padding: "14px",
            borderRadius: "10px",
            border: "1px solid var(--studio-border)",
            background: "var(--studio-panel)",
            display: "grid",
            gap: "10px",
          }}
        >
          <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
            <input
              type="text"
              aria-label="Local Git Base Repo Path"
              data-testid="variant-repo-input"
              className="studio-input"
              placeholder="Optional local Git base repo path (or set NEWT_BASE_REPO_DIR)"
              value={baseRepoDir}
              onChange={(e) => setBaseRepoDir(e.target.value)}
              style={{ flex: 1, minWidth: "240px" }}
            />
            <button
              type="button"
              className="studio-btn primary"
              data-testid="variant-materialize-btn"
              disabled={busy}
              onClick={() => void handleMaterialize()}
            >
              {busy ? "Building..." : "Materialize Variant"}
            </button>
            {variant ? (
              <button
                type="button"
                className="studio-btn"
                data-testid="variant-rebase-btn"
                disabled={busy}
                onClick={() => void handleRebase(false)}
              >
                Rebase Onto Upstream HEAD
              </button>
            ) : null}
          </div>

          {steps.length > 0 ? (
            <div style={{ display: "grid", gap: "6px" }} data-testid="variant-build-steps">
              <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--studio-muted)" }}>
                ASYNC WORKTREE BUILD PROGRESS
              </div>
              {steps.map((s, idx) => (
                <div
                  key={`${s.stage}-${idx}`}
                  style={{
                    padding: "7px 10px",
                    borderRadius: "8px",
                    border: "1px solid var(--studio-border)",
                    background: "var(--studio-bg)",
                    fontSize: "12px",
                    display: "flex",
                    justifyContent: "space-between",
                    gap: "8px",
                  }}
                >
                  <span>
                    <strong>{s.stage}</strong> — {s.message}
                  </span>
                  {s.port ? <code>:{s.port}</code> : null}
                </div>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
