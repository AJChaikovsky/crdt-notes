import type { Parameters } from "fast-check";

/**
 * Shared fast-check settings for every property test.
 *
 * `NUM_RUNS` sets how many generated cases each property checks: 100 by default for fast
 * local feedback, 10000 in CI (Continuous Integration). `SEED` replays one exact run.
 * The seed is always printed so any failure can be reproduced.
 */
export function propertyParameters<T>(): Parameters<T> {
  const numRuns = Number(process.env["NUM_RUNS"] ?? 100);
  const seed =
    process.env["SEED"] === undefined ? Date.now() : Number(process.env["SEED"]);
  console.info(`fast-check: numRuns=${numRuns} seed=${seed}`);
  return { numRuns, seed };
}
