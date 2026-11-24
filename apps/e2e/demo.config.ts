import { defineConfig } from "@playwright/test";
import base from "./playwright.config.js";

// `pnpm demo`: records docs/demo.gif (roadmap Phase 7) against the same built app and
// sync server as the exit test. Needs ffmpeg on the PATH.
export default defineConfig({
  ...base,
  testDir: "demo",
  timeout: 180_000,
});
