import fc from "fast-check";
import type { Id } from "@crdt-notes/crdt";
import { Simulator } from "./simulator.js";

/**
 * One replica typing a run of characters in one go. Forward types left to right, each
 * character after the previous one. Backward types every character at the same index,
 * so each new character lands before the previous one.
 */
export interface Run {
  readonly index: number;
  readonly text: string;
  readonly direction: "forward" | "backward";
}

/**
 * A shared starting document, then one run per replica, all typed concurrently: no
 * replica sees another's run until every run is finished. Used by P7.
 */
export interface ConcurrentRuns {
  readonly base: string;
  readonly runs: readonly Run[];
  /** Picks for the order the runs are delivered in. */
  readonly drain: readonly number[];
}

const REPLICA_IDS = ["A", "B", "C", "D"] as const;

const run: fc.Arbitrary<Run> = fc.record({
  index: fc.nat({ max: 8 }),
  text: fc.string({
    unit: fc.constantFrom("a", "b", "c", "d", "e"),
    minLength: 2,
    maxLength: 5,
  }),
  direction: fc.constantFrom("forward" as const, "backward" as const),
});

export function concurrentRuns(): fc.Arbitrary<ConcurrentRuns> {
  return fc.record({
    base: fc.string({ unit: fc.constantFrom("a", "b", "c", "d", "e"), maxLength: 6 }),
    runs: fc.array(run, { minLength: 2, maxLength: REPLICA_IDS.length }),
    drain: fc.array(fc.nat({ max: 50 }), { maxLength: 20 }),
  });
}

/**
 * Types the base on replica 0 and delivers it everywhere, then types run `i` on replica
 * `i`, then delivers everything. Returns the simulator and, for each run, its character
 * IDs in the order they read in the run's own text.
 */
export function typeRuns(spec: ConcurrentRuns): { sim: Simulator; runIds: Id[][] } {
  const sim = new Simulator(REPLICA_IDS.slice(0, spec.runs.length));
  [...spec.base].forEach((char, i) => sim.edit(0, { kind: "insert", index: i, char }));
  sim.deliverAll();

  const runIds = spec.runs.map((r, replica) => {
    const start = Math.min(r.index, sim.text(replica).length);
    const chars = r.direction === "forward" ? [...r.text] : [...r.text].reverse();
    const ids = chars.map((char, k) => {
      const index = r.direction === "forward" ? start + k : start;
      const op = sim.edit(replica, { kind: "insert", index, char });
      if (op === null) throw new Error("an insert always happens");
      return op.id;
    });
    return r.direction === "forward" ? ids : ids.reverse();
  });

  let i = 0;
  sim.deliverAll(() => spec.drain[i++ % Math.max(spec.drain.length, 1)] ?? 0);
  return { sim, runIds };
}
