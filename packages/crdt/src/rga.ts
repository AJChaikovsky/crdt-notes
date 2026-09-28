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

/** A read-only view of one item in the document, visible or not. */
export interface ItemView {
  readonly id: Id;
  readonly char: string;
  readonly deleted: boolean;
}

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
  /** Remote ops that arrived before their origin or target, in arrival order (P4). */
  readonly #pending: Op[] = [];

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
   * Applies an op from another replica, in any order. An op whose origin (for an insert)
   * or target (for a delete) hasn't arrived yet is held back and applied as soon as it
   * has, so the network doesn't have to deliver ops causally (ADR-0003). The clock
   * observes the op on arrival, not when it is finally applied.
   *
   * @example Bob receives Alice's delete of "x" before the insert of "x":
   * ```ts
   * const alice = new Rga("A");
   * const x = alice.insert(null, "x");
   * const del = alice.delete(x.id);
   * const bob = new Rga("B");
   * bob.apply(del);    // target missing: held back
   * bob.pendingCount;  // 1
   * bob.apply(x);      // inserts "x", then applies the held delete
   * bob.text();        // ""
   * bob.pendingCount;  // 0
   * ```
   */
  apply(op: Op): void {
    this.#clock.observe(op.id);
    if (!this.#ready(op)) {
      // A duplicate of an op that is already waiting changes nothing (P2).
      if (!this.#pending.some((p) => compareIds(p.id, op.id) === 0))
        this.#pending.push(op);
      return;
    }
    this.#applyReady(op);
    // Applying one op can make held ones ready, and those can unblock more.
    for (let i = this.#pending.findIndex((p) => this.#ready(p)); i !== -1;) {
      const [next] = this.#pending.splice(i, 1);
      if (next !== undefined) this.#applyReady(next);
      i = this.#pending.findIndex((p) => this.#ready(p));
    }
  }

  /** How many remote ops are held back waiting for their origin or target. */
  get pendingCount(): number {
    return this.#pending.length;
  }

  /** The visible document. */
  text(): string {
    return this.#items
      .filter((item) => !item.deleted)
      .map((item) => item.char)
      .join("");
  }

  /**
   * The IDs of the visible characters, in document order: `visibleIds()[i]` names the
   * character at index `i` of `text()`. Lets an editor turn a cursor position into the
   * `origin` or `target` an op needs.
   */
  visibleIds(): Id[] {
    return this.#items.filter((item) => !item.deleted).map((item) => item.id);
  }

  /**
   * Every item in document order, tombstones included, as copies. Two replicas can show
   * the same `text()` while tombstones sit in different places, and a later insert typed
   * after one of those tombstones would then land differently on each. Comparing
   * `items()` catches that before any later insert exposes it.
   *
   * @example Bob deletes "x" while Alice concurrently types "y" after it. Both replicas
   * keep the tombstone, in the same place:
   * ```ts
   * const alice = new Rga("A");
   * const x = alice.insert(null, "x");   // (1,A)
   * const bob = new Rga("B");
   * bob.apply(x);
   * const del = bob.delete(x.id);        // (2,B)
   * const y = alice.insert(x.id, "y");   // (2,A), origin is the now-deleted "x"
   * alice.apply(del);
   * bob.apply(y);
   * alice.items(); // [x (deleted), y], and bob.items() is equal
   * ```
   */
  items(): ItemView[] {
    return this.#items.map(({ id, char, deleted }) => ({ id, char, deleted }));
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

  /** Whether the op's origin or target is here, so it can be applied now. */
  #ready(op: Op): boolean {
    if (op.kind === "delete") return this.#has(op.target);
    return op.origin === null || this.#has(op.origin);
  }

  #applyReady(op: Op): void {
    if (op.kind === "insert") this.#integrate(op);
    else this.#tombstone(op);
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
