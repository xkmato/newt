import { expect, test } from "@playwright/test";

test("builds both a standalone UI widget and an XKmato blog.sidebar Limb, toggles .dark mode, and inspects live SQLite rows", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(`PAGEERROR: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`CONSOLE_ERROR: ${msg.text()}`);
  });
  await page.goto("/");

  // Wait for Studio workspace and initial project to load
  await expect(page.getByTestId("compile-status-badge")).toContainText("Compiled");

  // 1. Create and build a Standalone UI Widget project
  await page.getByTestId("new-project-btn").click();
  await expect(page.getByTestId("new-project-panel")).toBeVisible();
  await page.getByTestId("new-project-name").fill("Focus Pomodoro Widget");
  await page.getByTestId("new-project-mode").selectOption("standalone-ui");
  await page.getByTestId("create-project-submit").click();

  await expect(page.getByTestId("standalone-simulator")).toBeVisible();

  await page
    .getByTestId("chat-prompt-input")
    .fill("Build a standalone Pomodoro focus timer and checklist widget");
  await page.getByTestId("chat-send-btn").click();

  await expect(page.getByTestId("agent-trace-list")).toContainText("snapshot.saved");
  await expect(page.getByTestId("compile-status-badge")).toContainText("Compiled");

  const standaloneFrame = page.frameLocator('[data-testid="limb-iframe-standalone.canvas"]');
  await expect(standaloneFrame.getByTestId("timer-display")).toContainText("25:00");

  // 2. Toggle .dark mode and verify both host document and embedded iframe receive dark mode
  await page.getByTestId("theme-toggle").click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(standaloneFrame.locator("html")).toHaveAttribute("data-newt-theme", "dark");

  // 3. Create and build an XKmato blog.sidebar Limb with SQLite sidecar
  await page.getByTestId("new-project-btn").click();
  await page.getByTestId("new-project-name").fill("XKmato Sidebar Margin Notes");
  await page.getByTestId("new-project-mode").selectOption("salamanda-limb");
  await page.getByTestId("new-project-base").selectOption("xkmato");
  await page.getByTestId("create-project-submit").click();

  await expect(page.getByTestId("xkmato-simulator")).toBeVisible();
  await page.getByTestId("slot-selector").selectOption("blog.sidebar");
  await page
    .getByTestId("chat-prompt-input")
    .fill("Build a personal margin notes widget for blog.sidebar using SQLite sidecar");
  await page.getByTestId("chat-send-btn").click();

  await expect(page.getByTestId("agent-trace-list")).toContainText("snapshot.saved");
  await expect(page.getByTestId("compile-status-badge")).toContainText("Compiled");

  // Verify XKmato progressive :has() blog.sidebar mounted inside /blog/launching-amphibian
  const sidebarFrame = page.frameLocator('[data-testid="limb-iframe-blog.sidebar"]');
  await expect(sidebarFrame.getByTestId("save-note-btn")).toBeVisible();
  await expect(sidebarFrame.locator("html")).toHaveAttribute("data-newt-theme", "dark");

  // Write a real note inside the sandboxed iframe -> persisted into in-browser sql.js SQLite!
  await sidebarFrame
    .getByLabel("Margin note text")
    .fill("Playwright E2E live SQLite note on Amphibian");
  await sidebarFrame.getByTestId("save-note-btn").click();
  await expect(sidebarFrame.getByText("Playwright E2E live SQLite note on Amphibian")).toBeVisible();
  expect(errors).toEqual([]);

  // 4. Switch to SQLite Sidecar Explorer and verify live SQLite table & inserted row
  await page.getByTestId("tab-sidecar").click();
  await expect(page.getByTestId("sidecar-table-margin_notes")).toBeVisible();
  await expect(page.getByTestId("sidecar-table-region")).toContainText(
    "Playwright E2E live SQLite note on Amphibian"
  );

  // 5. Switch to Contract & Security Inspector and verify PASS status
  await page.getByTestId("tab-contract").click();
  await expect(page.getByTestId("contract-inspector")).toContainText("PASS (0 errors)");
  await expect(page.getByTestId("contract-inspector")).toContainText("personal");
});
