import type { Id, ReplicaId } from "./id.js";

/**
 * A Lamport clock: one counter per replica that orders ops by causality without
 * synchronised wall clocks. If op A happened before op B (B's author had seen A), then
 * A's counter is smaller than B's. The reverse does not hold: a smaller counter may also
 * belong to an op concurrent with B.
 *
 * @example Bob sees Alice's character before typing, so his next ID is bigger:
 * ```ts
 * const alice = new Clock("A");
 * const bob = new Clock("B");
 * const a1 = alice.tick(); // { counter: 1, replica: "A" }
 * alice.tick();            // counter 2
 * const a3 = alice.tick(); // counter 3
 * bob.observe(a3);
 * bob.tick();              // { counter: 4, replica: "B" }, bigger than everything Bob saw
 * ```
 */
export class Clock {
  readonly replica: ReplicaId;
  #counter = 0;

  constructor(replica: ReplicaId) {
    this.replica = replica;
  }

  /** The highest counter this replica has created or observed. */
  get counter(): number {
    return this.#counter;
  }

  /** Stamps a new local op: bumps the counter and returns a fresh ID. */
  tick(): Id {
    this.#counter += 1;
    return { counter: this.#counter, replica: this.replica };
  }

  /** Records a remote op, so the next local ID is bigger than it. */
  observe(id: Id): void {
    this.#counter = Math.max(this.#counter, id.counter);
  }
}
