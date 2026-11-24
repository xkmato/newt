import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compileLimbVfs, computePatchSha256Digest } from "@newt/compiler";
import { xkmatoBaseSpec, xkmatoPlatformManifest } from "@newt/base-xkmato";
import { POST as postProject } from "../app/api/v1/projects/route";
import { POST as postChat } from "../app/api/v1/projects/[id]/chat/route";
import { GET as getVariant } from "../app/api/v1/projects/[id]/variant/route";
import { POST as postMaterialize } from "../app/api/v1/projects/[id]/variant/materialize/route";
import { POST as postRebase } from "../app/api/v1/projects/[id]/variant/rebase/route";
import { setStudioDaemonForTesting, StudioDaemon } from "../src/server/daemon";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function createLocalGitBaseRepo(dir: string): void {
  fs.mkdirSync(path.join(dir, "src/app"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "src/app/page.tsx"),
    "export default function Home() { return <h1>Vanilla XKMato Home</h1>; }\n",
    "utf8"
  );
  fs.writeFileSync(path.join(dir, "firestore.rules"), "rules_version = '2';\n", "utf8");
  fs.writeFileSync(path.join(dir, ".env"), "SECRET_KEY=top-secret\n", "utf8");

  git(dir, ["init"]);
  git(dir, ["config", "user.email", "test@newt.dev"]);
  git(dir, ["config", "user.name", "Newt Test"]);
  git(dir, ["add", "."]);
  git(dir, ["commit", "-m", "Initial base commit"]);
}

function parseSse(raw: string): Array<{ event: string; data: Record<string, unknown> }> {
  const out: Array<{ event: string; data: Record<string, unknown> }> = [];
  for (const block of raw.split("\n\n")) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    let event = "message";
    let dataStr = "";
    for (const line of trimmed.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataStr += line.slice(5).trim();
    }
    if (dataStr) out.push({ event, data: JSON.parse(dataStr) as Record<string, unknown> });
  }
  return out;
}

describe("Milestone 6 (Task 6.1) — Level 3 Full-Source Variant Authoring, SAL-EDIT-001, Materialization & Rebase Self-Repair", () => {
  let daemon: StudioDaemon;
  let tempRepoDir: string;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv.NEWT_ENABLE_L3_VARIANTS = process.env.NEWT_ENABLE_L3_VARIANTS;
    savedEnv.NEWT_STUDIO_DEMO_PROVIDER = process.env.NEWT_STUDIO_DEMO_PROVIDER;

    process.env.NEWT_ENABLE_L3_VARIANTS = "1";
    process.env.NEWT_STUDIO_DEMO_PROVIDER = "1";

    tempRepoDir = fs.mkdtempSync(path.join(os.tmpdir(), "newt-m6-git-base-"));
    createLocalGitBaseRepo(tempRepoDir);

    daemon = new StudioDaemon({ dbPath: ":memory:" });
    setStudioDaemonForTesting(daemon);
  });

  afterEach(() => {
    daemon.variants.cleanupAll();
    daemon.db.close();
    setStudioDaemonForTesting(undefined);
    fs.rmSync(tempRepoDir, { recursive: true, force: true });

    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("blocks forbidden Level 3 edits to .env*, firestore.rules, firebase.json, and salamanda.toml with SAL-EDIT-001", async () => {
    const l3BaseSpec = {
      ...xkmatoBaseSpec,
      extensions: { ...xkmatoBaseSpec.extensions, allow_levels: [1, 2, 3] as Array<1 | 2 | 3> },
    };

    for (const forbiddenFile of [".env", "firestore.rules", "firebase.json", "salamanda.toml"]) {
      const evilDiff = [
        `--- a/${forbiddenFile}`,
        `+++ b/${forbiddenFile}`,
        "@@ -1 +1 @@",
        "-old",
        "+hacked",
        "",
      ].join("\n");
      const digest = computePatchSha256Digest(evilDiff);

      const res = await compileLimbVfs(
        {
          "limb.toml": `
[limb]
id = "evil-l3-patch"
name = "Evil Patch"
version = "0.1.0"
level = 3
author = "uid:attacker"

[requires]
contract = ">=1.0"
base = "xkmato"

[patch]
diff_file = "patches/variant.patch"
digest = "${digest}"
touches = ["${forbiddenFile}"]

[permissions]
data_read = []
data_write = []
egress = []
sidecar = "none"
`,
          "patches/variant.patch": evilDiff,
        },
        {
          platformManifest: xkmatoPlatformManifest,
          baseSpec: l3BaseSpec,
        }
      );

      expect(res.valid).toBe(false);
      expect(res.diagnostics.some((d) => d.code === "SAL-EDIT-001")).toBe(true);
    }
  });

  it("synthesizes a Level 3 layout patch via VariantPatchAgent, streams Materializing->Building->Running against local Git repo, falls back to Stale on conflicting upstream commit, and self-repairs back to Running", async () => {
    // 1. Create project targeting xkmato
    const createRes = await postProject(
      new Request("http://localhost/api/v1/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-newt-uid": "uid:kenneth" },
        body: JSON.stringify({
          name: "L3 Layout Variant",
          mode: "salamanda-limb",
          baseTarget: "xkmato",
        }),
      })
    );
    expect(createRes.status).toBe(201);
    const { project } = (await createRes.json()) as { project: { id: string } };

    // 2. Prompt VariantPatchAgent via SSE chat with real base file context
    const basePage = fs.readFileSync(path.join(tempRepoDir, "src/app/page.tsx"), "utf8");
    const chatRes = await postChat(
      new Request(`http://localhost/api/v1/projects/${project.id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-newt-uid": "uid:kenneth" },
        body: JSON.stringify({
          prompt: "Create a Level 3 layout patch customizing the home heading",
          baseSourceFiles: { "src/app/page.tsx": basePage },
        }),
      }),
      { params: Promise.resolve({ id: project.id }) }
    );
    expect(chatRes.status).toBe(200);
    const chatFrames = parseSse(await chatRes.text());
    const synthStart = chatFrames.find((f) => f.event === "synthesis.started");
    expect((synthStart?.data.agents as string[])).toContain("variant-patch");

    const saved = chatFrames.find((f) => f.event === "snapshot.saved")!;
    expect(saved.data.ok).toBe(true);

    // Verify GET /variant reports compiled patch + sha256 digest + touches
    const varInfo = (await (
      await getVariant(new Request(`http://localhost/api/v1/projects/${project.id}/variant`), {
        params: Promise.resolve({ id: project.id }),
      })
    ).json()) as {
      patch: { diffFile: string; digest: string; touches: string[]; diff: string };
    };
    expect(varInfo.patch.diffFile).toBe("patches/variant.patch");
    expect(varInfo.patch.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(varInfo.patch.touches).toEqual(["src/app/page.tsx"]);

    // 3. Stream async worktree materialization (`Materializing -> Building -> Starting -> Running`)
    const matRes = await postMaterialize(
      new Request(`http://localhost/api/v1/projects/${project.id}/variant/materialize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseRepoDir: tempRepoDir }),
      }),
      { params: Promise.resolve({ id: project.id }) }
    );
    expect(matRes.status).toBe(200);
    const matFrames = parseSse(await matRes.text());
    const stages = matFrames
      .filter((f) => f.event === "variant.progress")
      .map((f) => f.data.stage);
    expect(stages).toEqual(["Materializing", "Building", "Starting", "Running"]);

    const readyRecord = matFrames.find((f) => f.event === "variant.ready")!.data as {
      variantId: string;
      state: string;
      worktreePath: string;
      metrics: { cacheHit: boolean };
    };
    expect(readyRecord.state).toBe("Running");
    expect(readyRecord.metrics.cacheHit).toBe(false);

    // Verify patched file inside isolated Git worktree while canonical base repo stays untouched!
    const wtContent = fs.readFileSync(path.join(readyRecord.worktreePath, "src/app/page.tsx"), "utf8");
    expect(wtContent).toContain("Custom L3 Layout Variant");
    expect(fs.readFileSync(path.join(tempRepoDir, "src/app/page.tsx"), "utf8")).toContain(
      "Vanilla XKMato Home"
    );

    // Verify second materialization hits content-addressed build cache (`cacheHit: true`)
    const matCachedRes = await postMaterialize(
      new Request(`http://localhost/api/v1/projects/${project.id}/variant/materialize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseRepoDir: tempRepoDir }),
      }),
      { params: Promise.resolve({ id: project.id }) }
    );
    const cachedFrames = parseSse(await matCachedRes.text());
    const cachedReady = cachedFrames.find((f) => f.event === "variant.ready")!.data as {
      variantId: string;
      metrics: { cacheHit: boolean };
    };
    expect(cachedReady.variantId).toBe(readyRecord.variantId);
    expect(cachedReady.metrics.cacheHit).toBe(true);

    // 4. Simulate conflicting upstream Base commit on `src/app/page.tsx`
    fs.writeFileSync(
      path.join(tempRepoDir, "src/app/page.tsx"),
      "export default function Home() { return <h1>Upstream XKmato v2 Breaking Header</h1>; }\n",
      "utf8"
    );
    git(tempRepoDir, ["commit", "-am", "Upstream v2 breaking layout change"]);

    // Rebase detects conflict -> marks Variant `Stale` & safely falls back to Vanilla Base!
    const staleRes = await postRebase(
      new Request(`http://localhost/api/v1/projects/${project.id}/variant/rebase`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newCommit: "HEAD", autoRepair: false }),
      }),
      { params: Promise.resolve({ id: project.id }) }
    );
    expect(staleRes.status).toBe(200);
    const staleBody = (await staleRes.json()) as {
      repaired: boolean;
      variant: { state: string; fallbackToVanilla: boolean; conflictReason: string };
    };
    expect(staleBody.repaired).toBe(false);
    expect(staleBody.variant.state).toBe("Stale");
    expect(staleBody.variant.fallbackToVanilla).toBe(true);
    expect(staleBody.variant.conflictReason).toBeTruthy();

    // 5. Trigger 1-click AI Self-Repair Rebase (`autoRepair: true`) -> regenerates patch & re-materializes to Running!
    const repairedRes = await postRebase(
      new Request(`http://localhost/api/v1/projects/${project.id}/variant/rebase`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newCommit: "HEAD", autoRepair: true }),
      }),
      { params: Promise.resolve({ id: project.id }) }
    );
    expect(repairedRes.status).toBe(200);
    const repairedBody = (await repairedRes.json()) as {
      repaired: boolean;
      variant: { state: string; fallbackToVanilla: boolean; worktreePath: string };
    };
    expect(repairedBody.repaired).toBe(true);
    expect(repairedBody.variant.state).toBe("Running");
    expect(repairedBody.variant.fallbackToVanilla).toBe(false);

    const repairedWtText = fs.readFileSync(
      path.join(repairedBody.variant.worktreePath, "src/app/page.tsx"),
      "utf8"
    );
    expect(repairedWtText).toContain("Custom L3 Layout Variant");
    expect(repairedWtText).toContain("Upstream XKmato v2 Breaking Header");
  });
});
