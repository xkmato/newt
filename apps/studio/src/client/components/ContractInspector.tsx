"use client";

import type { CompiledLimbBundle } from "../types";

export function ContractInspector(props: {
  compiled: CompiledLimbBundle | null;
  onApproveEgress?: (hosts: string[]) => void;
}) {
  const { compiled, onApproveEgress } = props;

  if (!compiled) {
    return (
      <div style={{ padding: "20px", fontSize: "13px", color: "var(--studio-muted)" }}>
        No compiled bundle yet.
      </div>
    );
  }

  const manifest = compiled.manifest;
  const maxBytes = 150 * 1024;

  return (
    <div style={{ padding: "16px", display: "grid", gap: "16px" }} data-testid="contract-inspector">
      {compiled.requiresEgressConsent ? (
        <div
          role="alert"
          style={{
            padding: "12px 14px",
            borderRadius: "10px",
            border: "1px solid #d97706",
            background: "color-mix(in oklab, #d97706 10%, var(--studio-panel))",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "12px",
          }}
        >
          <div style={{ fontSize: "12.5px" }}>
            <strong>NEWT-CONSENT-001 — External Egress Approval Required:</strong>{" "}
            {compiled.unapprovedEgressHosts.join(", ")}
          </div>
          {onApproveEgress ? (
            <button
              type="button"
              className="studio-btn primary"
              onClick={() => onApproveEgress(compiled.unapprovedEgressHosts)}
            >
              Approve Egress Hosts
            </button>
          ) : null}
        </div>
      ) : null}

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "12px",
        }}
      >
        <div
          style={{
            padding: "12px",
            borderRadius: "10px",
            border: "1px solid var(--studio-border)",
            background: "var(--studio-panel)",
          }}
        >
          <div style={{ fontSize: "11px", color: "var(--studio-muted)", fontWeight: 700 }}>LIMB IDENTITY</div>
          <div style={{ marginTop: "6px", fontSize: "13px", display: "grid", gap: "4px" }}>
            <div>
              ID: <code>{compiled.limbId}</code>
            </div>
            <div>
              Level: <strong>L{manifest?.limb.level ?? "?"}</strong>
            </div>
            <div>
              Target Base: <code>{manifest?.requires.base ?? "?"}</code>
            </div>
            <div>
              Status:{" "}
              <strong style={{ color: compiled.valid ? "#16a34a" : "#ef4444" }}>
                {compiled.valid ? "PASS (0 errors)" : "INVALID"}
              </strong>
            </div>
          </div>
        </div>

        <div
          style={{
            padding: "12px",
            borderRadius: "10px",
            border: "1px solid var(--studio-border)",
            background: "var(--studio-panel)",
          }}
        >
          <div style={{ fontSize: "11px", color: "var(--studio-muted)", fontWeight: 700 }}>PERMISSIONS MATRIX</div>
          <div style={{ marginTop: "6px", fontSize: "12.5px", display: "grid", gap: "4px" }}>
            <div>
              Sidecar: <code>{manifest?.permissions.sidecar ?? "none"}</code>
            </div>
            <div>
              data_read: <code>{manifest?.permissions.data_read.join(", ") || "(none)"}</code>
            </div>
            <div>
              egress: <code>{manifest?.permissions.egress.join(", ") || "(none)"}</code>
            </div>
            <div>
              Limits: {manifest?.permissions.max_memory_mb ?? 64} MB / {manifest?.permissions.max_cpu_ms ?? 500} ms
            </div>
          </div>
        </div>

        <div
          style={{
            padding: "12px",
            borderRadius: "10px",
            border: "1px solid var(--studio-border)",
            background: "var(--studio-panel)",
          }}
        >
          <div style={{ fontSize: "11px", color: "var(--studio-muted)", fontWeight: 700 }}>
            SRCDOC BUNDLE BUDGET (&lt; 150 KB)
          </div>
          <div style={{ marginTop: "6px", fontSize: "12.5px", display: "grid", gap: "6px" }}>
            {Object.keys(compiled.bundleSizesBytes).length === 0 ? (
              <span style={{ color: "var(--studio-muted)" }}>No UI bundles compiled.</span>
            ) : (
              Object.entries(compiled.bundleSizesBytes).map(([asset, bytes]) => {
                const pct = Math.min(100, Math.round((bytes / maxBytes) * 100));
                return (
                  <div key={asset}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <code>{asset}</code>
                      <span>{(bytes / 1024).toFixed(1)} KB ({pct}%)</span>
                    </div>
                    <progress value={bytes} max={maxBytes} style={{ width: "100%" }} />
                  </div>
                );
              })
            )}
          </div>
        </div>
      </section>

      <section style={{ display: "grid", gap: "8px" }}>
        <h3 style={{ margin: 0, fontSize: "13.5px" }}>
          Compiler &amp; Policy Diagnostics ({compiled.diagnostics.length})
        </h3>
        {compiled.diagnostics.length === 0 ? (
          <div
            style={{
              padding: "12px",
              borderRadius: "8px",
              border: "1px solid var(--studio-border)",
              background: "var(--studio-panel)",
              fontSize: "12.5px",
              color: "#16a34a",
            }}
          >
            All 6 deterministic compiler stages passed with zero diagnostics.
          </div>
        ) : (
          <div style={{ display: "grid", gap: "6px" }}>
            {compiled.diagnostics.map((d, i) => (
              <div
                key={`${d.code}-${i}`}
                style={{
                  padding: "10px 12px",
                  borderRadius: "8px",
                  border: "1px solid var(--studio-border)",
                  background: "var(--studio-panel)",
                  fontSize: "12.5px",
                }}
              >
                <div>
                  <strong>[{d.code}]</strong> ({d.severity}) · <code>{d.path}</code>
                </div>
                <div style={{ marginTop: "3px" }}>{d.message}</div>
                {d.hint ? (
                  <div style={{ marginTop: "3px", color: "var(--studio-muted)", fontSize: "12px" }}>
                    Hint: {d.hint}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
