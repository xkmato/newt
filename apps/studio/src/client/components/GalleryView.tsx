"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { GalleryListingRecord } from "@newt/db";

type GalleryItemDto = GalleryListingRecord & { entitled: boolean };

export function GalleryView() {
  const [listings, setListings] = useState<GalleryItemDto[]>([]);
  const [baseFilter, setBaseFilter] = useState<string>("");
  const [selected, setSelected] = useState<GalleryItemDto | null>(null);
  const [egressChecked, setEgressChecked] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  const loadGallery = async (base: string) => {
    const qs = base ? `?base=${encodeURIComponent(base)}` : "";
    const res = await fetch(`/api/v1/gallery${qs}`);
    if (!res.ok) return;
    const body = (await res.json()) as { listings: GalleryItemDto[] };
    setListings(body.listings);
  };

  useEffect(() => {
    void loadGallery(baseFilter);
  }, [baseFilter]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onClose = () => {
      // Reset returnValue so stale button values never leak across Esc dismissals
      dialog.returnValue = "";
      setSelected(null);
      setEgressChecked(false);
    };
    dialog.addEventListener("close", onClose);
    return () => dialog.removeEventListener("close", onClose);
  }, []);

  const openConsentDialog = (item: GalleryItemDto) => {
    setSelected(item);
    setEgressChecked(item.permissionsSummary.egress.length === 0);
    setStatusMsg(null);
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
    }
  };

  const handleConfirmInstall = async () => {
    if (!selected || installing) return;
    setInstalling(true);
    setStatusMsg(null);
    try {
      const res = await fetch(
        `/api/v1/gallery/${encodeURIComponent(selected.limbId)}/install`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            approvedEgressHosts: egressChecked ? selected.permissionsSummary.egress : [],
          }),
        }
      );
      const body = (await res.json()) as {
        installed?: boolean;
        error?: string;
        code?: string;
      };
      if (!res.ok) {
        setStatusMsg(body.error ?? `Install blocked (${res.status})`);
        return;
      }
      setStatusMsg(`Installed '${selected.limbId}' into your active Salamanda session.`);
      dialogRef.current?.close("installed");
      await loadGallery(baseFilter);
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--studio-bg)", color: "var(--studio-fg)" }}>
      <header className="studio-header">
        <div className="studio-brand">
          <span style={{ color: "var(--studio-accent)", fontSize: "18px" }}>✦</span>
          <span>Newt Limb Gallery</span>
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <select
            aria-label="Filter gallery by base platform"
            className="studio-select"
            value={baseFilter}
            onChange={(e) => setBaseFilter(e.target.value)}
          >
            <option value="">All Base Platforms</option>
            <option value="xkmato">XKmato</option>
            <option value="generic-blog">Generic Indie Blog</option>
          </select>
          <Link href="/" className="studio-btn" style={{ textDecoration: "none" }}>
            ← Back to Studio
          </Link>
        </div>
      </header>

      <main style={{ maxWidth: "1040px", margin: "0 auto", padding: "24px 16px", display: "grid", gap: "16px" }}>
        <div>
          <h1 style={{ margin: "0 0 6px", fontSize: "22px" }}>Community &amp; Creator Limbs</h1>
          <p style={{ margin: 0, fontSize: "13.5px", color: "var(--studio-muted)" }}>
            Every published Limb displays its verified Salamanda permissions and entitlement status before installation.
          </p>
        </div>

        {statusMsg ? (
          <div
            role="status"
            style={{
              padding: "10px 14px",
              borderRadius: "8px",
              border: "1px solid var(--studio-border)",
              background: "var(--studio-panel)",
              fontSize: "13px",
            }}
          >
            {statusMsg}
          </div>
        ) : null}

        {listings.length === 0 ? (
          <div
            style={{
              padding: "28px",
              borderRadius: "12px",
              border: "1px dashed var(--studio-border)",
              background: "var(--studio-panel)",
              fontSize: "13.5px",
              color: "var(--studio-muted)",
            }}
          >
            No public Limbs published yet. Build a Limb in Newt Studio and publish it via{" "}
            <code>POST /api/v1/projects/:id/publish</code>.
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
              gap: "14px",
            }}
          >
            {listings.map((item) => (
              <article
                key={item.limbId}
                data-testid={`gallery-card-${item.limbId}`}
                style={{
                  padding: "16px",
                  borderRadius: "12px",
                  border: "1px solid var(--studio-border)",
                  background: "var(--studio-panel)",
                  display: "grid",
                  gap: "10px",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: "8px" }}>
                  <div>
                    <h2 style={{ margin: 0, fontSize: "15.5px" }}>{item.title}</h2>
                    <div style={{ fontSize: "12px", color: "var(--studio-muted)" }}>
                      <code>{item.baseTarget}</code> · L{item.permissionsSummary.level} · {item.installsCount} installs
                    </div>
                  </div>
                  <span className="studio-badge" data-state={item.entitled ? "valid" : "warn"}>
                    {item.monetizationMode === "free"
                      ? "Free"
                      : item.priceLabel ?? item.monetizationMode}
                  </span>
                </div>

                <p style={{ margin: 0, fontSize: "13px", color: "var(--studio-muted)" }}>
                  {item.description || "Published Salamanda Limb."}
                </p>

                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", fontSize: "11.5px" }}>
                  <span className="studio-badge">
                    Slots: {item.permissionsSummary.slots.join(", ") || "none"}
                  </span>
                  <span className="studio-badge">Sidecar: {item.permissionsSummary.sidecar}</span>
                  <span className="studio-badge">
                    Egress: {item.permissionsSummary.egress.join(", ") || "none"}
                  </span>
                </div>

                <button
                  type="button"
                  className="studio-btn primary"
                  data-testid={`gallery-install-${item.limbId}`}
                  onClick={() => openConsentDialog(item)}
                >
                  Review Permissions &amp; Install
                </button>
              </article>
            ))}
          </div>
        )}
      </main>

      {/* Native Modal Permission Consent Dialog */}
      <dialog
        ref={dialogRef}
        className="consent-dialog"
        aria-labelledby="consent-dialog-title"
        data-testid="permission-consent-dialog"
      >
        {selected ? (
          <div style={{ display: "grid", gap: "12px" }}>
            <h2 id="consent-dialog-title" style={{ margin: 0, fontSize: "17px" }}>
              Install {selected.title}
            </h2>
            <p style={{ margin: 0, fontSize: "13px", color: "var(--studio-muted)" }}>
              Review the verified Salamanda permissions before binding <code>{selected.limbId}</code> to your session:
            </p>
            <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "13px", display: "grid", gap: "4px" }}>
              <li>
                Extension Level: <strong>Level {selected.permissionsSummary.level}</strong>
              </li>
              <li>
                Named Slots: <code>{selected.permissionsSummary.slots.join(", ")}</code>
              </li>
              <li>
                Canonical Reads: <code>{selected.permissionsSummary.dataRead.join(", ") || "(none)"}</code>
              </li>
              <li>
                SQLite Sidecar Scope: <code>{selected.permissionsSummary.sidecar}</code>
              </li>
              <li>
                External Egress:{" "}
                <code>{selected.permissionsSummary.egress.join(", ") || "(none — offline only)"}</code>
              </li>
            </ul>

            {selected.permissionsSummary.egress.length > 0 ? (
              <label style={{ display: "flex", alignItems: "start", gap: "8px", fontSize: "12.5px" }}>
                <input
                  type="checkbox"
                  checked={egressChecked}
                  onChange={(e) => setEgressChecked(e.target.checked)}
                />
                <span>
                  I explicitly approve external HTTPS egress to{" "}
                  <strong>{selected.permissionsSummary.egress.join(", ")}</strong> (NEWT-CONSENT-001).
                </span>
              </label>
            ) : null}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "6px" }}>
              <button
                type="button"
                className="studio-btn"
                autoFocus
                onClick={() => dialogRef.current?.close("cancel")}
              >
                Cancel
              </button>
              <button
                type="button"
                className="studio-btn primary"
                disabled={installing || !egressChecked}
                onClick={() => void handleConfirmInstall()}
              >
                {installing ? "Installing..." : "Confirm & Bind"}
              </button>
            </div>
          </div>
        ) : null}
      </dialog>
    </div>
  );
}
