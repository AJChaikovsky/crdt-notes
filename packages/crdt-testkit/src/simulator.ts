import type { Id, ReplicaId } from "@crdt-notes/crdt";
import type { Implementation, ListCrdt, OpShape } from "./implementation.js";

/** A local edit, addressed by visible index the way a user's cursor would be. */
export type Edit =
  | { readonly kind: "insert"; readonly index: number; readonly char: string }
  | { readonly kind: "delete"; readonly index: number };

/** An op plus the ops its author had applied when making it (its causal dependencies). */
export interface SentOp<O extends OpShape> {
  readonly op: O;
  readonly deps: ReadonlySet<string>;
}

/** A pending delivery of `sent` to replica `to`. */
export interface Delivery<O extends OpShape> {
  readonly to: number;
  readonly sent: SentOp<O>;
}

/** A stable string key for an op, so ops can live in sets. */
export function opKey(id: Id): string {
  return `${id.counter}:${id.replica}`;
}

interface Replica<O extends OpShape> {
  readonly doc: ListCrdt<O>;
  readonly applied: Set<string>;
}

/**
 * N in-memory replicas connected by a network that delivers ops in any causally valid
 * order: an op reaches a replica only once every op its author had applied has been
 * applied there too. Dependencies are tracked as explicit sets of op keys (see
 * `docs/glossary.md`), which is simple enough to trust as an oracle.
 *
 * With `{ causal: false }` the network may deliver any pending op at any time, ignoring
 * dependencies. That is how P4 checks that replicas hold early ops back.
 */
export class Simulator<O extends OpShape> {
  readonly #replicas: Replica<O>[];
  readonly #pending: Delivery<O>[] = [];
  /** Every op ever made, in the order it was made, so it can be sent again. */
  readonly #log: SentOp<O>[] = [];

  readonly #causal: boolean;

  constructor(
    impl: Implementation<O>,
    replicaIds: readonly ReplicaId[],
    options: { causal?: boolean } = {},
  ) {
    this.#replicas = replicaIds.map((id) => ({
      doc: impl.create(id),
      applied: new Set(),
    }));
    this.#causal = options.causal ?? true;
  }

  get size(): number {
    return this.#replicas.length;
  }

  /**
   * Makes a local edit on replica `from` and queues the op for every other replica.
   * The index is clamped to the current text, so any generated edit is valid. A delete
   * on an empty document does nothing. Returns the op, or `null` if nothing happened.
   *
   * An insert at index `i` uses the visible character at `i - 1` as its origin (or
   * `null` at the start), even if tombstones sit between that character and the cursor.
   */
  edit(from: number, edit: Edit): O | null {
    const replica = this.#replica(from);
    const ids = replica.doc.visibleIds();
    const deps = new Set(replica.applied);
    let op: O;
    if (edit.kind === "insert") {
      const index = Math.min(edit.index, ids.length);
      op = replica.doc.insert(ids[index - 1] ?? null, edit.char);
    } else {
      if (ids.length === 0) return null;
      const target = ids[edit.index % ids.length];
      if (target === undefined) return null;
      op = replica.doc.delete(target);
    }
    replica.applied.add(opKey(op.id));
    this.#log.push({ op, deps });
    for (let to = 0; to < this.#replicas.length; to += 1) {
      if (to !== from) this.#pending.push({ to, sent: { op, deps } });
    }
    return op;
  }

  /**
   * Deliveries whose dependencies are all applied at their destination, or every pending
   * delivery when the network isn't causal.
   */
  deliverable(): Delivery<O>[] {
    if (!this.#causal) return [...this.#pending];
    return this.#pending.filter(({ to, sent }) => {
      const applied = this.#replica(to).applied;
      for (const dep of sent.deps) if (!applied.has(dep)) return false;
      return true;
    });
  }

  /** Applies one pending delivery. Throws if it isn't causally ready. */
  deliver(delivery: Delivery<O>): void {
    const index = this.#pending.indexOf(delivery);
    if (index === -1) throw new Error("not a pending delivery");
    if (!this.deliverable().includes(delivery))
      throw new Error("delivery not causally ready");
    this.#pending.splice(index, 1);
    const replica = this.#replica(delivery.to);
    replica.doc.apply(delivery.sent.op);
    replica.applied.add(opKey(delivery.sent.op.id));
  }

  /**
   * Delivers everything still pending. `pick` chooses which ready delivery goes next
   * (by index into the ready list), so a generator can control the order.
   */
  deliverAll(pick: (ready: number) => number = () => 0): void {
    for (let ready = this.deliverable(); ready.length > 0; ready = this.deliverable()) {
      const next = ready[pick(ready.length) % ready.length];
      if (next === undefined) throw new Error("unreachable");
      this.deliver(next);
    }
    if (this.#pending.length > 0)
      throw new Error("deliveries stuck: dependency never sent");
  }

  /**
   * Sends replica `to` an op it has already applied again, the way a sync server might
   * replay ops after a reconnect. Its own ops count too: a server can echo them back.
   * `pick` chooses which one (wrapped into range). Returns the op, or `null` if the
   * replica hasn't applied anything yet. A duplicate must change nothing (P2).
   */
  redeliver(to: number, pick: number): O | null {
    const replica = this.#replica(to);
    const seen = this.#log.filter(({ op }) => replica.applied.has(opKey(op.id)));
    const again = seen[pick % Math.max(seen.length, 1)];
    if (again === undefined) return null;
    replica.doc.apply(again.op);
    return again.op;
  }

  /**
   * Every op ever made, in the order it was made. That order is causally valid: an op's
   * dependencies were all made before it, so a fresh replica can apply the log in order.
   */
  log(): SentOp<O>[] {
    return [...this.#log];
  }

  /** Every delivery not yet made, ready or not. */
  pending(): Delivery<O>[] {
    return [...this.#pending];
  }

  get pendingCount(): number {
    return this.#pending.length;
  }

  text(replica: number): string {
    return this.#replica(replica).doc.text();
  }

  /** Replica `replica`'s document, for checks beyond its text. */
  doc(replica: number): ListCrdt<O> {
    return this.#replica(replica).doc;
  }

  texts(): string[] {
    return this.#replicas.map((r) => r.doc.text());
  }

  #replica(index: number): Replica<O> {
    const replica = this.#replicas[index];
    if (replica === undefined) throw new Error(`no replica ${index}`);
    return replica;
  }
}
