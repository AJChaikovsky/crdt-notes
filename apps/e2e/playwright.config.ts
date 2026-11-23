import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// Ports of their own, so a dev server left running on 8787 or 5173 can't get in the way.
const SYNC_PORT = 8788;
const APP_PORT = 4174;
const dataDir = mkdtempSync(join(tmpdir(), "crdt-notes-e2e-"));

export default defineConfig({
  testDir: "tests",
  timeout: 60_000,
  fullyParallel: false,
  forbidOnly: process.env["CI"] !== undefined,
  reporter: process.env["CI"] === undefined ? "list" : [["list"], ["github"]],
  use: {
    baseURL: `http://localhost:${APP_PORT}/`,
    ...devices["Desktop Chrome"],
    trace: "off",
  },
  webServer: [
    {
      command: `pnpm --filter @crdt-notes/server start`,
      env: { PORT: String(SYNC_PORT), DATA_DIR: dataDir },
      port: SYNC_PORT,
      reuseExistingServer: false,
    },
    {
      // The built app, service worker included, the way people get it.
      command: `pnpm --filter @crdt-notes/web build && pnpm --filter @crdt-notes/web exec vite preview --port ${APP_PORT} --strictPort`,
      env: { VITE_SYNC_URL: `ws://localhost:${SYNC_PORT}` },
      url: `http://localhost:${APP_PORT}/`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
