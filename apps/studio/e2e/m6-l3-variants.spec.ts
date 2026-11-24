import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

async function waitForUrl(url: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

test("Milestone 6 Studio UI: Level 3 Patch Diff Review, async worktree materialization, Stale rebase conflict banner, and 1-click AI self-repair", async ({
  page,
}) => {
  const l3Port = 3197;
  const l3Origin = `http://127.0.0.1:${l3Port}`;
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "newt-m6-ui-repo-"));
  fs.mkdirSync(path.join(repoDir, "src/app"), { recursive: true });
  fs.writeFileSync(
    path.join(repoDir, "src/app/page.tsx"),
    "export default function Home() { return <h1>Vanilla Base Layout</h1>; }\n",
    "utf8"
  );
  git(repoDir, ["init"]);
  git(repoDir, ["config", "user.email", "test@newt.dev"]);
  git(repoDir, ["config", "user.name", "Newt Test"]);
  git(repoDir, ["add", "."]);
  git(repoDir, ["commit", "-m", "Initial commit"]);

  const l3Server = spawn("pnpm", ["exec", "next", "start", "-p", String(l3Port)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NEWT_DB_PATH: ":memory:",
      NEWT_STUDIO_DEMO_PROVIDER: "1",
      NEWT_ENABLE_L3_VARIANTS: "1",
      NEWT_BASE_REPO_DIR: repoDir,
    },
    stdio: "pipe",
  });

  try {
    await waitForUrl(`${l3Origin}/api/v1/health`);
    await page.goto(l3Origin);

    await expect(page.getByTestId("compile-status-badge")).toContainText("Compiled");
    await expect(page.getByTestId("tab-variant")).toBeVisible();

    // Synthesize a Level 3 layout patch via Studio chat
    await page
      .getByTestId("chat-prompt-input")
      .fill("Build a Level 3 layout patch customizing the root page heading");
    await page.getByTestId("chat-send-btn").click();
    await expect(page.getByTestId("agent-trace-list")).toContainText("snapshot.saved");

    // Open Level 3 Variant tab -> inspect Patch Diff Review & SAL-EDIT-001 badge
    await page.getByTestId("tab-variant").click();
    await expect(page.getByTestId("patch-diff-review")).toBeVisible();
    await expect(page.getByTestId("patch-diff-review")).toContainText("SAL-EDIT-001 ✓");

    // Trigger async Git worktree materialization
    await page.getByTestId("variant-materialize-btn").click();
    await expect(page.getByTestId("variant-state-badge")).toContainText("Running");
    await expect(page.getByTestId("variant-build-steps")).toContainText("Materializing");
    await expect(page.getByTestId("variant-build-steps")).toContainText("Building");

    // Commit a conflicting upstream Base change -> click Rebase -> expect Stale conflict banner
    fs.writeFileSync(
      path.join(repoDir, "src/app/page.tsx"),
      "export default function Home() { return <h1>Upstream v2 Breaking Layout</h1>; }\n",
      "utf8"
    );
    git(repoDir, ["commit", "-am", "Upstream v2 breaking layout"]);

    await page.getByTestId("variant-rebase-btn").click();
    await expect(page.getByTestId("rebase-conflict-banner")).toBeVisible();
    await expect(page.getByTestId("variant-state-badge")).toContainText("Stale");

    // Click 1-click AI Self-Repair -> resolves conflict and returns to Running!
    await page.getByTestId("variant-self-repair-btn").click();
    await expect(page.getByTestId("variant-state-badge")).toContainText("Running");
    await expect(page.getByTestId("rebase-conflict-banner")).toBeHidden();
  } finally {
    if (!l3Server.killed) l3Server.kill("SIGTERM");
    fs.rmSync(repoDir, { recursive: true, force: true });
  }
});
