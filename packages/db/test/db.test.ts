import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NewtDatabase } from "../src/index.js";

describe("@newt/db SQLite WAL checkpoint store", () => {
  it("persists projects, VFS snapshots, diffs, and 1-click rollbacks across WAL reopens", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "newt-db-test-"));
    const dbFile = path.join(tmpDir, "newt.db");

    try {
      const db1 = NewtDatabase.open(dbFile);
      const proj = db1.createProject({
        ownerUid: "uid:kenneth",
        limbId: "luganda-reader",
        name: "Luganda Audio Reader",
        mode: "salamanda-limb",
        baseTarget: "xkmato",
        initialFiles: {
          "limb.toml": '[limb]\nid = "luganda-reader"\n',
          "src/ui/Player.tsx": "export default function Player() { return <div>v1</div>; }",
        },
        initialSummary: "Initial v1 player",
      });

      const snap1 = db1.getCurrentSnapshot(proj.id)!;
      expect(snap1.summary).toBe("Initial v1 player");

      const snap2 = db1.saveSnapshot({
        projectId: proj.id,
        files: {
          "limb.toml": '[limb]\nid = "luganda-reader"\n',
          "src/ui/Player.tsx": "export default function Player() { return <div>v2 + speed</div>; }",
          "migrations/001_bookmarks.sql": "CREATE TABLE bookmarks (post_id TEXT PRIMARY KEY);",
        },
        summary: "Added speed toggle & bookmarks SQL",
      });

      const diffs = db1.diffSnapshots(snap1.id, snap2.id);
      expect(diffs.map((d) => `${d.status}:${d.path}`)).toEqual([
        "added:migrations/001_bookmarks.sql",
        "modified:src/ui/Player.tsx",
      ]);

      // 1-click rollback back to snap1
      const rolled = db1.rollbackProjectToSnapshot(proj.id, snap1.id);
      expect(rolled.id).toBe(snap1.id);
      expect(db1.getCurrentSnapshot(proj.id)?.files["migrations/001_bookmarks.sql"]).toBeUndefined();

      const thread = db1.createThread(proj.id);
      db1.appendMessage({
        threadId: thread.id,
        role: "user",
        content: { prompt: "Add speed selector" },
      });
      db1.appendMessage({
        threadId: thread.id,
        role: "assistant",
        content: { summary: "Updated Player.tsx" },
        snapshotId: snap2.id,
      });

      db1.close();

      // Reopen on disk to verify WAL durability
      const db2 = NewtDatabase.open(dbFile);
      const reopenedProj = db2.getProject(proj.id);
      expect(reopenedProj?.currentSnapshotId).toBe(snap1.id);
      expect(db2.listSnapshots(proj.id)).toHaveLength(2);
      expect(db2.listMessages(thread.id)).toHaveLength(2);
      db2.close();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("enforces gallery monetization entitlements (free vs ledger_gate)", () => {
    const db = NewtDatabase.openInMemory();
    try {
      const proj = db.createProject({
        ownerUid: "uid:kenneth",
        limbId: "prediction-casino",
        name: "Essay Prediction Market",
        mode: "salamanda-limb",
        baseTarget: "xkmato",
        initialFiles: { "limb.toml": "" },
      });

      db.upsertGalleryListing({
        limbId: "prediction-casino",
        projectId: proj.id,
        authorUid: "uid:kenneth",
        title: "Essay Prediction Market",
        description: "Community speculation sidebar.",
        baseTarget: "xkmato",
        publishedDigest: "sha256:abc123",
        visibility: "public",
        monetizationMode: "ledger_gate",
        priceLabel: "500 sats",
        permissionsSummary: {
          level: 2,
          slots: ["blog.sidebar"],
          dataRead: ["blogposts"],
          egress: [],
          sidecar: "shared",
        },
      });

      // Author always entitled; unentitled reader denied until receipt is granted
      expect(db.hasEntitlement("prediction-casino", "uid:kenneth")).toBe(true);
      expect(db.hasEntitlement("prediction-casino", "uid:alice")).toBe(false);

      db.grantEntitlement({
        limbId: "prediction-casino",
        consumerUid: "uid:alice",
        grantSource: "payment_receipt",
        externalReceiptId: "xk_wallet_rcpt_991",
      });

      expect(db.hasEntitlement("prediction-casino", "uid:alice")).toBe(true);
      expect(db.getGalleryListing("prediction-casino")?.installsCount).toBe(1);
    } finally {
      db.close();
    }
  });
});
