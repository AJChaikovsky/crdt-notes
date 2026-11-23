import {
  FastFugue,
  Fugue,
  Rga,
  type FugueOp,
  type Id,
  type ItemView,
  type Op,
  type ReplicaId,
} from "@crdt-notes/crdt";

/** The parts of an op the testkit reads. RGA's `Op` and Fugue's `FugueOp` both fit. */
export type OpShape =
  | { readonly kind: "insert"; readonly id: Id }
  | { readonly kind: "delete"; readonly id: Id; readonly target: Id };

/**
 * One replica of a list CRDT (Conflict-free Replicated Data Type), as the testkit drives
 * it. It lives here, not in the core, because the tests are the only code that uses more
 * than one implementation (ADR-0004).
 */
export interface ListCrdt<O extends OpShape> {
  insert(origin: Id | null, char: string): O;
  delete(target: Id): O;
  apply(op: O): void;
  text(): string;
  visibleIds(): Id[];
  items(): ItemView[];
  readonly pendingCount: number;
}

/** A named way to make replicas, so each property can run once per implementation. */
export interface Implementation<O extends OpShape> {
  readonly name: string;
  create(replica: ReplicaId): ListCrdt<O>;
}

export const rga: Implementation<Op> = { name: "RGA", create: (id) => new Rga(id) };

export const fugue: Implementation<FugueOp> = {
  name: "Fugue",
  create: (id) => new Fugue(id),
};

/** Fugue with a B-tree for positions (ADR-0006). Must behave exactly like `fugue`. */
export const fastFugue: Implementation<FugueOp> = {
  name: "FastFugue",
  create: (id) => new FastFugue(id),
};

/**
 * A replica from `fugue` or `fastFugue`, with the methods the testkit's interface leaves
 * out (`snapshot`, `insertAt`, `deleteAt`). Throws for any other implementation.
 */
export function asFugueDoc(doc: ListCrdt<FugueOp>): Fugue | FastFugue {
  if (doc instanceof Fugue || doc instanceof FastFugue) return doc;
  throw new Error("not a Fugue or FastFugue replica");
}
