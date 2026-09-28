import { Clock } from "./clock.js";
import { compareIds, type Id, type ReplicaId } from "./id.js";

/**
 * Insert one character after `origin` (the ID of the character it was typed after), or
 * at the start of the document when `origin` is `null`. `origin` is an ID, not an index,
 * because indices shift under concurrent edits.
 */
export interface InsertOp {
  readonly kind: "insert";
  readonly id: Id;
  readonly origin: Id | null;
  readonly char: string;
}

/**
 * Delete the character named `target`. The delete gets its own `id` from the Lamport
 * clock, so the sync layer can track which deletes a replica has seen (ADR-0002).
 */
export interface DeleteOp {
  readonly kind: "delete";
  readonly id: Id;
  readonly target: Id;
}

/** Any operation a replica can send to its peers. */
export type Op = InsertOp | DeleteOp;

interface Item {
  readonly id: Id;
  readonly char: string;
  /** A deleted item is a tombstone: hidden from `text()`, but kept as an origin. */
  deleted: boolean;
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
    const op: InsertOp = { kind: "insert", id: this.#clock.tick(), origin, char };
    this.#integrate(op);
    return op;
  }

  /** Creates a local delete of `target`, applies it, and returns it to send to peers. */
  delete(target: Id): DeleteOp {
    const op: DeleteOp = { kind: "delete", id: this.#clock.tick(), target };
    this.#tombstone(op);
    return op;
  }

  /**
   * Applies an op from another replica.
   *
   * @throws if the op's origin or target hasn't arrived yet. Buffering such ops until it
   * arrives (P4, causal readiness) is a later step.
   */
  apply(op: Op): void {
    this.#clock.observe(op.id);
    if (op.kind === "insert") this.#integrate(op);
    else this.#tombstone(op);
  }

  /** The visible document. */
  text(): string {
    return this.#items
      .filter((item) => !item.deleted)
      .map((item) => item.char)
      .join("");
  }

  #integrate(op: InsertOp): void {
    // An insert delivered twice (say, replayed by the sync server) is a no-op.
    if (this.#has(op.id)) return;
    let i = op.origin === null ? 0 : this.#indexOf(op.origin) + 1;
    // Skip every item with a bigger ID, tombstones included. Those are newer siblings of
    // `op` plus everything typed after them, which the Lamport clock guarantees has an
    // even bigger ID.
    for (let item = this.#items[i]; item !== undefined; item = this.#items[i]) {
      if (compareIds(item.id, op.id) < 0) break;
      i += 1;
    }
    this.#items.splice(i, 0, { id: op.id, char: op.char, deleted: false });
  }

  #tombstone(op: DeleteOp): void {
    const item = this.#items[this.#indexOf(op.target)];
    // Deleting an already-deleted item changes nothing, so repeats and concurrent
    // deletes of the same character agree.
    if (item !== undefined) item.deleted = true;
  }

  #has(id: Id): boolean {
    return this.#items.some((item) => compareIds(item.id, id) === 0);
  }

  #indexOf(id: Id): number {
    const index = this.#items.findIndex((item) => compareIds(item.id, id) === 0);
    if (index === -1) {
      throw new Error(`(${id.counter}, ${id.replica}) has not been applied yet`);
    }
    return index;
  }
}
