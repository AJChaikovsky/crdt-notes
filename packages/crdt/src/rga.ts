import { Clock } from "./clock.js";
import { compareIds, type Id, type ReplicaId } from "./id.js";

/**
 * Insert one character after `origin` (the ID of the character it was typed after), or
 * at the start of the document when `origin` is `null`. `origin` is an ID, not an index,
 * because indices shift under concurrent edits.
 */
export interface InsertOp {
  readonly id: Id;
  readonly origin: Id | null;
  readonly char: string;
}

interface Item {
  readonly id: Id;
  readonly char: string;
}

/**
 * One replica of a text document, using RGA (Replicated Growable Array).
 *
 * This is the naive reference implementation: a plain array in document order and an
 * O(n) scan per op. It is meant to be read, and later to check the optimised version
 * against.
 *
 * @example Alice and Bob both type after "H" at the same time. Whichever order the ops
 * arrive in, both replicas end up with the same text:
 * ```ts
 * const alice = new Rga("A");
 * const h = alice.insert(null, "H");     // (1,A)
 * const bob = new Rga("B");
 * bob.apply(h);
 * const i = alice.insert(h.id, "i");     // (2,A)
 * const o = bob.insert(h.id, "o");       // (2,B)
 * alice.apply(o);
 * bob.apply(i);
 * alice.text(); // "Hoi"
 * bob.text();   // "Hoi": (2,B) is bigger, so "o" sits closer to "H"
 * ```
 */
export class Rga {
  readonly #clock: Clock;
  readonly #items: Item[] = [];

  constructor(replica: ReplicaId) {
    this.#clock = new Clock(replica);
  }

  /** Creates a local insert after `origin`, applies it, and returns it to send to peers. */
  insert(origin: Id | null, char: string): InsertOp {
    const op: InsertOp = { id: this.#clock.tick(), origin, char };
    this.#integrate(op);
    return op;
  }

  /**
   * Applies an insert from another replica.
   *
   * @throws if `op.origin` hasn't arrived yet. Buffering such ops until their origin
   * arrives (P4, causal readiness) is a later step.
   */
  apply(op: InsertOp): void {
    this.#clock.observe(op.id);
    this.#integrate(op);
  }

  /** The visible document. */
  text(): string {
    return this.#items.map((item) => item.char).join("");
  }

  #integrate(op: InsertOp): void {
    let i = op.origin === null ? 0 : this.#indexOf(op.origin) + 1;
    // Skip every item with a bigger ID. Those are newer siblings of `op` plus everything
    // typed after them, which the Lamport clock guarantees has an even bigger ID.
    for (let item = this.#items[i]; item !== undefined; item = this.#items[i]) {
      if (compareIds(item.id, op.id) < 0) break;
      i += 1;
    }
    this.#items.splice(i, 0, { id: op.id, char: op.char });
  }

  #indexOf(id: Id): number {
    const index = this.#items.findIndex((item) => compareIds(item.id, id) === 0);
    if (index === -1) {
      throw new Error(`origin (${id.counter}, ${id.replica}) has not been applied yet`);
    }
    return index;
  }
}
