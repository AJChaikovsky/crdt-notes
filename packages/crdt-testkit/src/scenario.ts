import fc from "fast-check";
import { Simulator, type Edit } from "./simulator.js";

/**
 * One step of a scenario: a local edit, delivering one ready op, or sending a replica an
 * op it already has.
 */
export type Step =
  | { readonly kind: "edit"; readonly replica: number; readonly edit: Edit }
  | { readonly kind: "deliver"; readonly pick: number }
  | { readonly kind: "redeliver"; readonly replica: number; readonly pick: number };

/**
 * A random run of the simulator, as plain data. Replica numbers, indices and picks are
 * raw numbers that the simulator wraps into range, so every scenario is valid and
 * fast-check can shrink one by deleting steps or shrinking numbers without making it
 * impossible to run.
 */
export interface Scenario {
  readonly replicas: number;
  readonly steps: readonly Step[];
  /** Picks for draining whatever is still pending after `steps`. */
  readonly drain: readonly number[];
}

const REPLICA_IDS = ["A", "B", "C", "D", "E"] as const;

// Inserts are weighted 3:1 over deletes so documents grow enough to be interesting.
const edit: fc.Arbitrary<Edit> = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.record({
      kind: fc.constant("insert" as const),
      index: fc.nat({ max: 20 }),
      char: fc.constantFrom("a", "b", "c", "d", "e"),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant("delete" as const),
      index: fc.nat({ max: 20 }),
    }),
  },
);

// Duplicates are rarer than edits and deliveries, but mixed in with them, so a duplicate
// can arrive after later ops have changed the document around it.
const step: fc.Arbitrary<Step> = fc.oneof(
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant("edit" as const),
      replica: fc.nat({ max: 4 }),
      edit,
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant("deliver" as const),
      pick: fc.nat({ max: 50 }),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant("redeliver" as const),
      replica: fc.nat({ max: 4 }),
      pick: fc.nat({ max: 50 }),
    }),
  },
);

/** Scenarios with 2 to 5 replicas and up to `maxSteps` steps. */
export function scenario(maxSteps = 60): fc.Arbitrary<Scenario> {
  return fc.record({
    replicas: fc.integer({ min: 2, max: REPLICA_IDS.length }),
    // fast-check's default size keeps arrays to a handful of items; "medium" gives
    // scenarios long enough for concurrent edits to pile up.
    steps: fc.array(step, { maxLength: maxSteps, size: "medium" }),
    drain: fc.array(fc.nat({ max: 50 }), { maxLength: 20 }),
  });
}

/**
 * The same scenario with every duplicate removed. Duplicates don't touch the network
 * queue, so the remaining steps pick exactly the same deliveries as before.
 */
export function withoutDuplicates(scenario: Scenario): Scenario {
  return { ...scenario, steps: scenario.steps.filter((s) => s.kind !== "redeliver") };
}

/** `causal: false` lets the network deliver ops before their dependencies (for P4). */
export interface RunOptions {
  readonly causal?: boolean;
}

/**
 * Runs the steps of `scenario` without draining, so replicas may still disagree and ops
 * may still be in flight.
 */
export function runSteps(scenario: Scenario, options: RunOptions = {}): Simulator {
  const sim = new Simulator(REPLICA_IDS.slice(0, scenario.replicas), options);
  for (const s of scenario.steps) {
    if (s.kind === "edit") {
      sim.edit(s.replica % sim.size, s.edit);
    } else if (s.kind === "redeliver") {
      sim.redeliver(s.replica % sim.size, s.pick);
    } else {
      const ready = sim.deliverable();
      const next = ready[s.pick % Math.max(ready.length, 1)];
      if (next !== undefined) sim.deliver(next);
    }
  }
  return sim;
}

/** Runs `scenario` to the end, delivering everything, and returns the simulator. */
export function run(scenario: Scenario, options: RunOptions = {}): Simulator {
  const sim = runSteps(scenario, options);
  let i = 0;
  sim.deliverAll(() => scenario.drain[i++ % Math.max(scenario.drain.length, 1)] ?? 0);
  return sim;
}

/**
 * A scenario followed by two edits on different replicas, made before either sees the
 * other's, so the two ops are concurrent. Used by P3.
 */
export interface ConcurrentPair {
  readonly scenario: Scenario;
  readonly first: { readonly replica: number; readonly edit: Edit };
  readonly second: { readonly offset: number; readonly edit: Edit };
}

export function concurrentPair(maxSteps = 60): fc.Arbitrary<ConcurrentPair> {
  return fc.record({
    scenario: scenario(maxSteps),
    first: fc.record({ replica: fc.nat({ max: 4 }), edit }),
    // The second replica is 1 to size - 1 places after the first, so it always differs.
    second: fc.record({ offset: fc.nat({ max: 3 }), edit }),
  });
}
