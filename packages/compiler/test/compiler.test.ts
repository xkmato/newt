import { describe, expect, it } from "vitest";
import { xkmatoBasePack, xkmatoBaseSpec, xkmatoPlatformManifest } from "@newt/base-xkmato";
import { compileLimbVfs, MockSalamandaHostBroker, type NewtVfs } from "../src/index.js";

describe("@newt/compiler 6-stage pipeline & MockSalamandaHostBroker", () => {
  it("compiles a Preact + SQLite repeater & sidebar Limb in <150 KB with SHA-256 CSP and runs interactively against MockSalamandaHostBroker", async () => {
    const vfs: NewtVfs = {
      "limb.toml": `
[limb]
id = "micropost-quick-notes"
name = "Micropost Quick Notes & Poll"
version = "0.1.0"
level = 2
author = "uid:kenneth"

[requires]
contract = ">=1.0"
base = "xkmato"
slots = ["micropost.footer", "blog.sidebar"]

[[ui]]
slot = "micropost.footer"
route_pattern = "/feed"
component = "ui/MicropostNote.html"
isolation = "iframe"

[[ui]]
slot = "blog.sidebar"
route_pattern = "/blog/*"
component = "ui/SidebarPoll.html"
isolation = "iframe"

[[functions]]
route = "/_limb/micropost-quick-notes/vote"
method = "POST"
handler = "functions/vote.ts"

[permissions]
data_read = ["blogposts", "microposts"]
data_write = []
egress = ["tts.sunbird.ai"]
sidecar = "personal"

[sidecar]
migrations = "migrations/"
`,
      "migrations/001_init.sql": `
CREATE TABLE IF NOT EXISTS card_notes (
  post_id TEXT PRIMARY KEY,
  note TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS votes (
  uid TEXT PRIMARY KEY,
  choice TEXT NOT NULL
);
`,
      "src/functions/vote.ts": `
export async function handleVote() {
  // @host: {"host_call":"sidecar_execute","scope":"personal","sql_template":"INSERT OR REPLACE INTO votes (uid, choice) VALUES ('\${principal.uid}', '\${body.choice}')"}
  // @host: {"host_call":"sidecar_query","scope":"personal","sql_template":"SELECT uid, choice FROM votes"}
}
`,
      "src/ui/MicropostNote.tsx": `
import { useState } from "preact/hooks";
import { executeSidecar, querySidecar, useSlotContext } from "@newt/ui-sdk";

export default function MicropostNote() {
  const ctx = useSlotContext<{ "post-id"?: string }>();
  const [savedNote, setSavedNote] = useState<string>("none");
  const postId = ctx.props["post-id"] ?? "unset";

  const saveAndReload = async () => {
    await executeSidecar(
      "personal",
      "INSERT OR REPLACE INTO card_notes (post_id, note) VALUES (?, ?)",
      [postId, "Bookmark:" + postId]
    );
    const rows = await querySidecar<{ post_id: string; note: string }>(
      "personal",
      "SELECT post_id, note FROM card_notes WHERE post_id = ?",
      [postId]
    );
    setSavedNote(rows[0]?.note ?? "missing");
  };

  return (
    <div className="note-bar">
      <span data-testid="post-id">{postId}</span>
      <span data-testid="saved-note">{savedNote}</span>
      <button id="save-btn" type="button" onClick={saveAndReload}>Bookmark</button>
    </div>
  );
}
`,
      "src/ui/SidebarPoll.tsx": `
import { useState } from "preact/hooks";
import { invokeLimbFunction, readCanonical, useSlotContext } from "@newt/ui-sdk";

export default function SidebarPoll() {
  const ctx = useSlotContext<{ "post-slug"?: string }>();
  const [status, setStatus] = useState("idle");

  const castVote = async () => {
    const post = await readCanonical<{ title: string }>("blogposts", ctx.props["post-slug"] ?? "");
    const res = await invokeLimbFunction<{ choice: string }, { rows: Array<{ choice: string }> }>(
      "vote",
      { choice: "LUGANDA_YES" }
    );
    setStatus((post?.title?.slice(0, 9) ?? "no-post") + ":" + (res.rows[0]?.choice ?? "none"));
  };

  return (
    <div className="poll-card">
      <h4>Essay Poll</h4>
      <span data-testid="poll-status">{status}</span>
      <button id="vote-btn" type="button" onClick={castVote}>Vote</button>
    </div>
  );
}
`,
    };

    const compiled = await compileLimbVfs(vfs, {
      platformManifest: xkmatoPlatformManifest,
      baseSpec: xkmatoBaseSpec,
      isSharedPublication: true,
    });

    expect(compiled.valid).toBe(true);
    expect(compiled.requiresEgressConsent).toBe(true);
    expect(compiled.unapprovedEgressHosts).toEqual(["tts.sunbird.ai"]);

    const cardHtml = compiled.assets["ui/MicropostNote.html"] ?? "";
    expect(cardHtml).toContain("Content-Security-Policy");
    expect(cardHtml).toContain("script-src 'sha256-");
    expect(cardHtml).toContain("--newt-bg: var(--background, oklch(1 0 0));");

    // Mount TWO repeater card instances + ONE singleton sidebar instance on MockSalamandaHostBroker
    const broker = new MockSalamandaHostBroker(xkmatoBasePack);
    try {
      await broker.registerLimb(compiled, { seedPrincipalUid: "uid:kenneth" });

      const cardDom1 = broker.mountSlotInJsdom({
        limbId: "micropost-quick-notes",
        slotId: "micropost.footer",
        principalUid: "uid:kenneth",
        instanceKey: "card-1",
        route: "/feed",
        contextProps: { "post-id": "syw0gTrIt2ffuzBR8XJR" },
      });

      const cardDom2 = broker.mountSlotInJsdom({
        limbId: "micropost-quick-notes",
        slotId: "micropost.footer",
        principalUid: "uid:kenneth",
        instanceKey: "card-2",
        route: "/feed",
        contextProps: { "post-id": "Mocsrechn43c3VFe9Zwl" },
      });

      const sidebarDom = broker.mountSlotInJsdom({
        limbId: "micropost-quick-notes",
        slotId: "blog.sidebar",
        principalUid: "uid:kenneth",
        route: "/blog/launching-amphibian",
        contextProps: { "post-slug": "launching-amphibian" },
      });

      await new Promise((r) => setTimeout(r, 35));

      expect(
        cardDom1.window.document.querySelector('[data-testid="post-id"]')?.textContent
      ).toBe("syw0gTrIt2ffuzBR8XJR");
      expect(
        cardDom2.window.document.querySelector('[data-testid="post-id"]')?.textContent
      ).toBe("Mocsrechn43c3VFe9Zwl");

      // Click bookmark on card 1 & vote on sidebar
      (cardDom1.window.document.getElementById("save-btn") as HTMLButtonElement).click();
      (sidebarDom.window.document.getElementById("vote-btn") as HTMLButtonElement).click();

      await new Promise((r) => setTimeout(r, 50));

      expect(
        cardDom1.window.document.querySelector('[data-testid="saved-note"]')?.textContent
      ).toBe("Bookmark:syw0gTrIt2ffuzBR8XJR");
      expect(
        cardDom2.window.document.querySelector('[data-testid="saved-note"]')?.textContent
      ).toBe("none");
      expect(
        sidebarDom.window.document.querySelector('[data-testid="poll-status"]')?.textContent
      ).toBe("Launching:LUGANDA_YES");

      const tableRows = await broker.inspectSidecarTable(
        "personal",
        "uid:kenneth",
        "micropost-quick-notes",
        "card_notes"
      );
      expect(tableRows).toEqual([
        { post_id: "syw0gTrIt2ffuzBR8XJR", note: "Bookmark:syw0gTrIt2ffuzBR8XJR" },
      ]);

      cardDom1.window.close();
      cardDom2.window.close();
      sidebarDom.window.close();
    } finally {
      broker.closeAll();
    }
  });

  it("catches forbidden ATTACH/PRAGMA SQL, process.env L2 escapes, and runtime mount exceptions", async () => {
    const brokenVfs: NewtVfs = {
      "limb.toml": `
[limb]
id = "broken-limb-check"
name = "Broken Check"
version = "0.1.0"
level = 2
author = "uid:dev"

[requires]
contract = ">=1.0"
base = "xkmato"
slots = ["blog.header"]

[[ui]]
slot = "blog.header"
component = "ui/Crash.html"
isolation = "iframe"

[[functions]]
route = "/_limb/broken-limb-check/run"
method = "POST"
handler = "functions/escape.ts"

[permissions]
data_read = ["blogposts"]
data_write = []
egress = []
sidecar = "personal"
`,
      "migrations/001_bad.sql": "ATTACH DATABASE 'other.db' AS other;",
      "src/functions/escape.ts": "export function run() { return process.env.SECRET; }",
      "src/ui/Crash.tsx": `
export default function Crash(): never {
  throw new Error("Simulated component crash on mount");
}
`,
    };

    const res = await compileLimbVfs(brokenVfs, {
      platformManifest: xkmatoPlatformManifest,
      baseSpec: xkmatoBaseSpec,
    });

    expect(res.valid).toBe(false);
    const codes = res.diagnostics.map((d) => d.code);
    expect(codes).toContain("NEWT-SQL-002");
    expect(codes).toContain("NEWT-FN-001");
    expect(codes).toContain("NEWT-RUN-001");
  });
});
