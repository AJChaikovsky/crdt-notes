import { defineConfig } from "vitest/config";

// Benchmarks are slow and machine-dependent, so they run on demand (`pnpm bench`), not
// in `pnpm test` or CI.
export default defineConfig({
  test: {
    include: ["packages/*/bench/**/*.bench.test.ts"],
    testTimeout: 30 * 60 * 1000,
  },
});
