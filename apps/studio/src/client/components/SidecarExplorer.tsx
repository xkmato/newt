"use client";

import { useEffect, useState } from "react";
import type { SqlValue } from "sql.js";
import type { BrowserSalamandaHostBroker, SidecarTableInfo } from "../browser-broker";

export function SidecarExplorer(props: { broker: BrowserSalamandaHostBroker }) {
  const { broker } = props;
  const [tables, setTables] = useState<SidecarTableInfo[]>([]);
  const [selected, setSelected] = useState<SidecarTableInfo | null>(null);
  const [sql, setSql] = useState<string>("");
  const [result, setResult] = useState<{
    columns: string[];
    rows: Array<Record<string, SqlValue>>;
    error?: string;
  }>({ columns: [], rows: [] });

  const refresh = () => {
    const list = broker.listTables();
    setTables(list);
    const active =
      (selected && list.find((t) => t.dbKey === selected.dbKey && t.tableName === selected.tableName)) ??
      list[0] ??
      null;
    setSelected(active);
    if (active) {
      const nextSql =
        selected && selected.tableName === active.tableName && sql.trim().length > 0
          ? sql
          : `SELECT * FROM ${active.tableName} ORDER BY rowid DESC LIMIT 100`;
      setSql(nextSql);
      setResult(broker.executeInspectorQuery(active.dbKey, nextSql));
    } else {
      setResult({ columns: [], rows: [] });
    }
  };

  useEffect(() => {
    refresh();
    return broker.subscribe(() => {
      const list = broker.listTables();
      setTables(list);
      const target = list[0] ?? null;
      if (target) {
        setSelected((prev) => {
          const matched = prev
            ? list.find((t) => t.dbKey === prev.dbKey && t.tableName === prev.tableName) ?? target
            : target;
          const queryStr = `SELECT * FROM ${matched.tableName} ORDER BY rowid DESC LIMIT 100`;
          setSql(queryStr);
          setResult(broker.executeInspectorQuery(matched.dbKey, queryStr));
          return matched;
        });
      }
    });
  }, [broker]);

  const runCustomQuery = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    setResult(broker.executeInspectorQuery(selected.dbKey, sql));
  };

  return (
    <div style={{ padding: "16px", display: "grid", gap: "14px" }} data-testid="sidecar-explorer">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "15px" }}>SQLite Sidecar Explorer (In-Browser sql.js)</h2>
          <p style={{ margin: "2px 0 0", fontSize: "12px", color: "var(--studio-muted)" }}>
            Inspects live WebAssembly SQLite rows written by Limbs running inside the Preview simulator.
          </p>
        </div>
        <button type="button" className="studio-btn" onClick={refresh} data-testid="refresh-sidecar-btn">
          Refresh Tables
        </button>
      </div>

      {tables.length === 0 ? (
        <div
          style={{
            padding: "20px",
            borderRadius: "10px",
            border: "1px dashed var(--studio-border)",
            fontSize: "13px",
            color: "var(--studio-muted)",
          }}
        >
          No active SQLite sidecar tables yet. Build or preview a Limb with{" "}
          <code>permissions.sidecar = "personal"</code> or <code>"shared"</code> to inspect live tables here.
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            {tables.map((t) => {
              const isSelected = selected?.dbKey === t.dbKey && selected?.tableName === t.tableName;
              return (
                <button
                  key={`${t.dbKey}:${t.tableName}`}
                  type="button"
                  className={`studio-btn ${isSelected ? "primary" : ""}`}
                  data-testid={`sidecar-table-${t.tableName}`}
                  onClick={() => {
                    setSelected(t);
                    const q = `SELECT * FROM ${t.tableName} ORDER BY rowid DESC LIMIT 100`;
                    setSql(q);
                    setResult(broker.executeInspectorQuery(t.dbKey, q));
                  }}
                >
                  {t.tableName} ({t.rowCount}) · {t.scope}
                </button>
              );
            })}
          </div>

          <form onSubmit={runCustomQuery} style={{ display: "flex", gap: "8px" }}>
            <input
              type="text"
              aria-label="Read-only SQL SELECT query"
              className="studio-input"
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              style={{ flex: 1, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
            />
            <button type="submit" className="studio-btn primary">
              Run SELECT
            </button>
          </form>

          {result.error ? (
            <div style={{ color: "#ef4444", fontSize: "12.5px" }}>{result.error}</div>
          ) : (
            <div
              tabIndex={0}
              role="region"
              aria-labelledby="sidecar-table-caption"
              className="table-wrapper"
              data-testid="sidecar-table-region"
            >
              <table className="sidecar-table">
                <caption id="sidecar-table-caption">
                  Table: {selected?.tableName} ({result.rows.length} row{result.rows.length === 1 ? "" : "s"})
                </caption>
                <thead>
                  <tr>
                    {result.columns.map((col) => (
                      <th key={col} scope="col">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.length === 0 ? (
                    <tr>
                      <td colSpan={Math.max(1, result.columns.length)} data-col-label="Status">
                        Table is empty.
                      </td>
                    </tr>
                  ) : (
                    result.rows.map((row, rowIdx) => (
                      <tr key={rowIdx}>
                        {result.columns.map((col, colIdx) => {
                          const display = row[col] === null || row[col] === undefined ? "NULL" : String(row[col]);
                          if (colIdx === 0) {
                            return (
                              <th key={col} scope="row">
                                {display}
                              </th>
                            );
                          }
                          return (
                            <td key={col} data-col-label={col}>
                              {display}
                            </td>
                          );
                        })}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
