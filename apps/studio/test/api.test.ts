import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as getHealth } from "../app/api/v1/health/route";
import { GET as getBases, POST as postBase } from "../app/api/v1/bases/route";
import { GET as getProjects, POST as postProject } from "../app/api/v1/projects/route";
import { GET as getProject } from "../app/api/v1/projects/[id]/route";
import { GET as getFiles, PUT as putFiles } from "../app/api/v1/projects/[id]/files/route";
import { POST as postRollback } from "../app/api/v1/projects/[id]/rollback/route";
import { POST as postChat } from "../app/api/v1/projects/[id]/chat/route";
import { setStudioDaemonForTesting, StudioDaemon } from "../src/server/daemon";

function parseSseFrames(raw: string): Array<{ event: string; data: Record<string, unknown> }> {
  const frames: Array<{ event: string; data: Record<string, unknown> }> = [];
  for (const block of raw.split("\n\n")) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    let event = "message";
    let dataStr = "";
    for (const line of trimmed.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataStr += line.slice(5).trim();
    }
    if (dataStr) {
      frames.push({ event, data: JSON.parse(dataStr) as Record<string, unknown> });
    }
  }
  return frames;
}

describe("Task 3.1 — Newt Daemon API & SSE Streaming Routes", () => {
  let daemon: StudioDaemon;

  beforeEach(() => {
    process.env.NEWT_STUDIO_DEMO_PROVIDER = "1";
    daemon = new StudioDaemon({ dbPath: ":memory:" });
    setStudioDaemonForTesting(daemon);
  });

  afterEach(() => {
    daemon.db.close();
    setStudioDaemonForTesting(undefined);
  });

  it("serves /health and /bases including xkmato, standalone, and custom registered manifests", async () => {
    const healthRes = await getHealth();
    expect(healthRes.status).toBe(200);
    const health = (await healthRes.json()) as { ok: boolean; bases: string[] };
    expect(health.ok).toBe(true);
    expect(health.bases).toContain("xkmato");
    expect(health.bases).toContain("standalone");

    const basesRes = await getBases();
    const basesBody = (await basesRes.json()) as { bases: Array<{ id: string }> };
    expect(basesBody.bases.map((b) => b.id)).toEqual(expect.arrayContaining(["xkmato", "standalone"]));

    const customRes = await postBase(
      new Request("http://localhost/api/v1/bases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          manifest: {
            contract_version: "1.0.0",
            base: { id: "custom-wiki", name: "Custom Wiki", framework: "astro" },
            runtime: { allow_levels: [1, 2], supports_client_only_hydration: true },
            auth: { strategy: "anonymous-dev" },
            theme: { tokens: { "--newt-bg": "--wiki-bg", "--newt-fg": "--wiki-fg" } },
            slots: [
              {
                id: "wiki.sidebar",
                cardinality: "singleton",
                description: "Wiki sidebar slot",
                routes: ["/*"],
                anchor_selector: '[data-salamanda-slot="wiki.sidebar"]',
                context_props: ["page-id"],
              },
            ],
          },
        }),
      })
    );
    expect(customRes.status).toBe(201);
  });

  it("verifies ordered SSE chat synthesis, manual file edits with recompile, and 1-click checkpoint rollback", async () => {
    // 1. Create an XKmato project
    const createRes = await postProject(
      new Request("http://localhost/api/v1/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-newt-uid": "uid:kenneth" },
        body: JSON.stringify({
          name: "Sidebar Notes",
          mode: "salamanda-limb",
          baseTarget: "xkmato",
          slotId: "blog.sidebar",
        }),
      })
    );
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as {
      project: { id: string; currentSnapshotId: number };
      snapshot: { id: number; files: Record<string, string> };
      compiled: { valid: boolean };
    };
    expect(created.compiled.valid).toBe(true);
    const projectId = created.project.id;
    const initialSnapshotId = created.snapshot.id;

    // 2. Verify project listing
    const listRes = await getProjects(
      new Request("http://localhost/api/v1/projects", {
        headers: { "x-newt-uid": "uid:kenneth" },
      })
    );
    const listed = (await listRes.json()) as { projects: Array<{ id: string }> };
    expect(listed.projects.some((p) => p.id === projectId)).toBe(true);

    // 3. Stream SSE chat turn to synthesize a SQLite blog.sidebar Limb
    const chatRes = await postChat(
      new Request(`http://localhost/api/v1/projects/${projectId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-newt-uid": "uid:kenneth" },
        body: JSON.stringify({
          prompt: "Build a personal margin notes widget for blog.sidebar using SQLite sidecar",
          selectedSlot: "blog.sidebar",
        }),
      }),
      { params: Promise.resolve({ id: projectId }) }
    );
    expect(chatRes.status).toBe(200);
    expect(chatRes.headers.get("Content-Type")).toContain("text/event-stream");

    const rawSse = await chatRes.text();
    const frames = parseSseFrames(rawSse);
    const eventNames = frames.map((f) => f.event);

    // Strict ordered agent lifecycle events
    expect(eventNames).toEqual([
      "gatekeeper.passed",
      "blueprint.ready",
      "synthesis.started",
      "vfs.updated",
      "compile.result",
      "turn.complete",
      "snapshot.saved",
    ]);

    const savedFrame = frames.find((f) => f.event === "snapshot.saved")!;
    expect(savedFrame.data.ok).toBe(true);
    const agentSnapshot = savedFrame.data.snapshot as {
      id: number;
      files: Record<string, string>;
      compiledBundle: { valid: boolean; assets: Record<string, string> };
    };
    expect(agentSnapshot.id).toBeGreaterThan(initialSnapshotId);
    expect(agentSnapshot.files["migrations/001_init.sql"]).toContain("CREATE TABLE");
    expect(agentSnapshot.compiledBundle.valid).toBe(true);

    // 4. Manual code edit via PUT /projects/:id/files
    const editedTsx = agentSnapshot.files["src/ui/MarginNotes.tsx"]!.replace(
      "Save Note to SQLite",
      "Persist Margin Note"
    );
    const editRes = await putFiles(
      new Request(`http://localhost/api/v1/projects/${projectId}/files`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patch: { "src/ui/MarginNotes.tsx": editedTsx },
          summary: "Rename save button text",
        }),
      }),
      { params: Promise.resolve({ id: projectId }) }
    );
    expect(editRes.status).toBe(200);
    const edited = (await editRes.json()) as {
      snapshot: { id: number; files: Record<string, string> };
      compiled: { valid: boolean; assets: Record<string, string> };
      diff: Array<{ path: string; status: string }>;
    };
    expect(edited.compiled.valid).toBe(true);
    expect(edited.compiled.assets["ui/MarginNotes.html"]).toContain("Persist Margin Note");
    expect(edited.diff).toEqual([{ path: "src/ui/MarginNotes.tsx", status: "modified", before: expect.any(String), after: expect.any(String) }]);

    // 5. Rollback to the agent snapshot (checkpoint restore)
    const rbRes = await postRollback(
      new Request(`http://localhost/api/v1/projects/${projectId}/rollback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshotId: agentSnapshot.id }),
      }),
      { params: Promise.resolve({ id: projectId }) }
    );
    expect(rbRes.status).toBe(200);

    const filesAfterRb = (await (
      await getFiles(new Request(`http://localhost/api/v1/projects/${projectId}/files`), {
        params: Promise.resolve({ id: projectId }),
      })
    ).json()) as { snapshotId: number; files: Record<string, string> };
    expect(filesAfterRb.snapshotId).toBe(agentSnapshot.id);
    expect(filesAfterRb.files["src/ui/MarginNotes.tsx"]).toContain("Save Note to SQLite");

    // 6. Verify detail endpoint includes message trace & snapshot history
    const detailRes = await getProject(
      new Request(`http://localhost/api/v1/projects/${projectId}`),
      { params: Promise.resolve({ id: projectId }) }
    );
    const detail = (await detailRes.json()) as {
      snapshots: unknown[];
      messages: unknown[];
    };
    expect(detail.snapshots.length).toBe(3);
    expect(detail.messages.length).toBe(2);
  });
});
