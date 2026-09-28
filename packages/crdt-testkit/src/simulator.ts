import { Rga, type Id, type Op, type ReplicaId } from "@crdt-notes/crdt";

/** A local edit, addressed by visible index the way a user's cursor would be. */
export type Edit =
  | { readonly kind: "insert"; readonly index: number; readonly char: string }
  | { readonly kind: "delete"; readonly index: number };

/** An op plus the ops its author had applied when making it (its causal dependencies). */
export interface SentOp {
  readonly op: Op;
  readonly deps: ReadonlySet<string>;
}

/** A pending delivery of `sent` to replica `to`. */
export interface Delivery {
  readonly to: number;
  readonly sent: SentOp;
}

/** A stable string key for an op, so ops can live in sets. */
export function opKey(id: Id): string {
  return `${id.counter}:${id.replica}`;
}

interface Replica {
  readonly rga: Rga;
  readonly applied: Set<string>;
}

/**
 * N in-memory replicas connected by a network that delivers ops in any causally valid
 * order: an op reaches a replica only once every op its author had applied has been
 * applied there too. Dependencies are tracked as explicit sets of op keys (see
 * `docs/glossary.md`), which is simple enough to trust as an oracle.
 */
export class Simulator {
  readonly #replicas: Replica[];
  readonly #pending: Delivery[] = [];

  constructor(replicaIds: readonly ReplicaId[]) {
    this.#replicas = replicaIds.map((id) => ({ rga: new Rga(id), applied: new Set() }));
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
  edit(from: number, edit: Edit): Op | null {
    const replica = this.#replica(from);
    const ids = replica.rga.visibleIds();
    const deps = new Set(replica.applied);
    let op: Op;
    if (edit.kind === "insert") {
      const index = Math.min(edit.index, ids.length);
      op = replica.rga.insert(ids[index - 1] ?? null, edit.char);
    } else {
      if (ids.length === 0) return null;
      const target = ids[edit.index % ids.length];
      if (target === undefined) return null;
      op = replica.rga.delete(target);
    }
    replica.applied.add(opKey(op.id));
    for (let to = 0; to < this.#replicas.length; to += 1) {
      if (to !== from) this.#pending.push({ to, sent: { op, deps } });
    }
    return op;
  }

  /** Deliveries whose dependencies are all applied at their destination. */
  deliverable(): Delivery[] {
    return this.#pending.filter(({ to, sent }) => {
      const applied = this.#replica(to).applied;
      for (const dep of sent.deps) if (!applied.has(dep)) return false;
      return true;
    });
  }

  /** Applies one pending delivery. Throws if it isn't causally ready. */
  deliver(delivery: Delivery): void {
    const index = this.#pending.indexOf(delivery);
    if (index === -1) throw new Error("not a pending delivery");
    if (!this.deliverable().includes(delivery))
      throw new Error("delivery not causally ready");
    this.#pending.splice(index, 1);
    const replica = this.#replica(delivery.to);
    replica.rga.apply(delivery.sent.op);
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

  /** Every delivery not yet made, ready or not. */
  pending(): Delivery[] {
    return [...this.#pending];
  }

  get pendingCount(): number {
    return this.#pending.length;
  }

  text(replica: number): string {
    return this.#replica(replica).rga.text();
  }

  texts(): string[] {
    return this.#replicas.map((r) => r.rga.text());
  }

  #replica(index: number): Replica {
    const replica = this.#replicas[index];
    if (replica === undefined) throw new Error(`no replica ${index}`);
    return replica;
  }
}
