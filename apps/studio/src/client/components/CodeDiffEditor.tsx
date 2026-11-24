"use client";

import { useEffect, useState } from "react";
import type { CompiledLimbBundle, NewtVfs, VfsFileDiff } from "../types";

export function CodeDiffEditor(props: {
  files: NewtVfs;
  diff: VfsFileDiff[];
  compiled: CompiledLimbBundle | null;
  saving: boolean;
  onSaveFile: (filePath: string, content: string) => Promise<void>;
}) {
  const { files, diff, compiled, saving, onSaveFile } = props;
  const paths = Object.keys(files).sort();
  const [selectedPath, setSelectedPath] = useState<string>(paths[0] ?? "limb.toml");
  const [draft, setDraft] = useState<string>(files[selectedPath] ?? "");
  const [viewMode, setViewMode] = useState<"edit" | "diff">("edit");

  useEffect(() => {
    if (!files[selectedPath] && paths[0]) {
      setSelectedPath(paths[0]);
      setDraft(files[paths[0]] ?? "");
    } else {
      setDraft(files[selectedPath] ?? "");
    }
  }, [files, selectedPath]);

  const dirty = (files[selectedPath] ?? "") !== draft;

  const handleSave = async () => {
    if (!selectedPath) return;
    await onSaveFile(selectedPath, draft);
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", height: "100%", minHeight: 0 }}>
      <aside
        style={{
          borderRight: "1px solid var(--studio-border)",
          background: "var(--studio-panel)",
          padding: "10px",
          overflow: "auto",
          display: "flex",
          flexDirection: "column",
          gap: "4px",
        }}
      >
        <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--studio-muted)", padding: "4px 6px" }}>
          PROJECT VFS FILES
        </div>
        {paths.map((p) => {
          const isDiffed = diff.some((d) => d.path === p);
          return (
            <button
              key={p}
              type="button"
              onClick={() => setSelectedPath(p)}
              style={{
                textAlign: "left",
                padding: "6px 8px",
                borderRadius: "6px",
                border: "none",
                background: selectedPath === p ? "var(--studio-surface)" : "transparent",
                color: "var(--studio-fg)",
                fontSize: "12px",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                cursor: "pointer",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p}</span>
              {isDiffed ? <span style={{ color: "var(--studio-accent)", fontSize: "10px" }}>●</span> : null}
            </button>
          );
        })}
      </aside>

      <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "8px 12px",
            borderBottom: "1px solid var(--studio-border)",
            background: "var(--studio-panel)",
            gap: "8px",
          }}
        >
          <code style={{ fontSize: "12.5px" }}>{selectedPath}</code>
          <div style={{ display: "flex", gap: "6px" }}>
            <button
              type="button"
              className={`studio-btn ${viewMode === "edit" ? "primary" : ""}`}
              onClick={() => setViewMode("edit")}
            >
              Edit
            </button>
            <button
              type="button"
              className={`studio-btn ${viewMode === "diff" ? "primary" : ""}`}
              onClick={() => setViewMode("diff")}
            >
              Diff ({diff.length})
            </button>
            <button
              type="button"
              className="studio-btn primary"
              data-testid="save-file-btn"
              disabled={!dirty || saving}
              onClick={() => void handleSave()}
            >
              {saving ? "Compiling..." : "Save & Recompile"}
            </button>
          </div>
        </div>

        {viewMode === "edit" ? (
          <textarea
            aria-label={`Edit ${selectedPath}`}
            data-testid="code-editor-textarea"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "s") {
                e.preventDefault();
                if (dirty && !saving) void handleSave();
              }
            }}
            spellCheck={false}
            style={{
              flex: 1,
              width: "100%",
              padding: "14px",
              border: "none",
              outline: "none",
              resize: "none",
              background: "var(--studio-bg)",
              color: "var(--studio-fg)",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: "12.5px",
              lineHeight: 1.55,
            }}
          />
        ) : (
          <div style={{ flex: 1, overflow: "auto", padding: "14px", display: "grid", gap: "12px" }}>
            {diff.length === 0 ? (
              <p style={{ margin: 0, fontSize: "13px", color: "var(--studio-muted)" }}>
                No differences from parent checkpoint.
              </p>
            ) : (
              diff.map((entry) => (
                <div
                  key={entry.path}
                  style={{
                    border: "1px solid var(--studio-border)",
                    borderRadius: "8px",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      padding: "6px 10px",
                      background: "var(--studio-surface)",
                      fontSize: "12px",
                      fontWeight: 600,
                      display: "flex",
                      justifyContent: "space-between",
                    }}
                  >
                    <code>{entry.path}</code>
                    <span className="studio-badge">{entry.status}</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", fontSize: "11.5px" }}>
                    <pre
                      style={{
                        margin: 0,
                        padding: "10px",
                        overflow: "auto",
                        borderRight: "1px solid var(--studio-border)",
                        background: "var(--studio-bg)",
                      }}
                    >
                      {entry.before ?? "(not present)"}
                    </pre>
                    <pre style={{ margin: 0, padding: "10px", overflow: "auto", background: "var(--studio-bg)" }}>
                      {entry.after ?? "(deleted)"}
                    </pre>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {compiled && compiled.diagnostics.length > 0 ? (
          <div
            style={{
              maxHeight: "140px",
              overflow: "auto",
              borderTop: "1px solid var(--studio-border)",
              background: "var(--studio-panel)",
              padding: "8px 12px",
              fontSize: "12px",
              display: "grid",
              gap: "4px",
            }}
          >
            {compiled.diagnostics.map((d, idx) => (
              <div key={`${d.code}-${idx}`}>
                <strong style={{ color: d.severity === "error" ? "#ef4444" : "var(--studio-accent)" }}>
                  [{d.code}]
                </strong>{" "}
                <code>{d.path}</code> — {d.message}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
