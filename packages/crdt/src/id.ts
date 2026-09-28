/**
 * Identifies one replica (one device or tab editing a document). The caller supplies
 * it: a UUID (Universally Unique Identifier) in the app, short names like `"A"` in tests.
 * The core never generates one, so every test run is deterministic.
 */
export type ReplicaId = string;

/**
 * The permanent name of one inserted character. Array indices shift under concurrent
 * edits; an `Id` never changes, so an op can say "insert after this character" and mean
 * the same character on every replica.
 *
 * `counter` comes from the author's Lamport clock (see {@link Clock}) and `replica` makes
 * the pair unique even when two replicas pick the same counter.
 */
export interface Id {
  readonly counter: number;
  readonly replica: ReplicaId;
}

/**
 * Total order on IDs: by `counter`, then by `replica`. Returns a negative number if `a`
 * is smaller, positive if bigger, 0 only for the same ID.
 *
 * Replica IDs are compared by UTF-16 code unit (plain `<`), never `localeCompare`, whose
 * answer depends on the machine's locale and would let two replicas disagree.
 *
 * @example Two replicas insert concurrently with the same counter. Every replica ranks
 * them the same way, so all of them put the siblings in the same order:
 * ```ts
 * compareIds({ counter: 3, replica: "B" }, { counter: 3, replica: "A" }); // > 0
 * compareIds({ counter: 2, replica: "Z" }, { counter: 3, replica: "A" }); // < 0
 * ```
 */
export function compareIds(a: Id, b: Id): number {
  if (a.counter !== b.counter) return a.counter - b.counter;
  if (a.replica === b.replica) return 0;
  return a.replica < b.replica ? -1 : 1;
}
