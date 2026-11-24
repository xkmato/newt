import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: "http://127.0.0.1:3199",
    channel: "chrome",
    headless: true,
    viewport: { width: 1280, height: 860 },
  },
  webServer: {
    command: "NEWT_DB_PATH=:memory: NEWT_STUDIO_DEMO_PROVIDER=1 pnpm next start -p 3199",
    port: 3199,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
