import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "packages/*/test/**/*.test.ts"],
    // At 10,000 cases (CI), a property that runs two implementations per case can take
    // several seconds on a CI runner, past vitest's 5 s default.
    testTimeout: 60_000,
  },
});
