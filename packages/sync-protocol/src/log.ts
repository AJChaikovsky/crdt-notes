import type { FugueOp, ReplicaId } from "@crdt-notes/crdt";

/**
 * One stored op with its author's sequence number: 1 for the author's first op, then 2,
 * 3, and so on with no gaps (ADR-0008). The author is `op.id.replica`.
 */
export interface Entry {
  readonly seq: number;
  readonly op: FugueOp;
}

/**
 * For each author, how many of their ops a side holds without a gap: 4 means ops 1 to 4
 * are all there. An author with nothing held is left out.
 */
export type VersionVector = ReadonlyMap<ReplicaId, number>;

/**
 * Every op of one document that this side holds, on the server or in a client, with the
 * bookkeeping to catch another side up (ADR-0008).
 *
 * @example Alice's client was offline while Bob kept typing. On reconnect, each side
 * sends what the other's vector says it lacks, and both end up holding the same ops:
 * ```ts
 * const toAlice = server.missing(alice.vector()); // Bob's ops Alice hasn't seen
 * const toServer = alice.missing(server.vector()); // what Alice typed offline
 * for (const entry of toAlice) alice.add(entry);
 * for (const entry of toServer) server.add(entry);
 * ```
 */
export class OpLog {
  /** Each author's entries by `seq`. */
  readonly #entries = new Map<ReplicaId, Map<number, Entry>>();
  /** Each author's unbroken run from 1: the version vector. */
  readonly #vector = new Map<ReplicaId, number>();

  /**
   * Stores an op this replica just made, under its author's next `seq`, and returns the
   * entry to send. The author must have been given every one of their own earlier ops.
   */
  append(op: FugueOp): Entry {
    const author = op.id.replica;
    const held = this.#entries.get(author)?.size ?? 0;
    if (held !== (this.#vector.get(author) ?? 0))
      throw new Error(`${author}'s own ops have a gap; it can't number a new one`);
    const entry: Entry = { seq: held + 1, op };
    this.add(entry);
    return entry;
  }

  /**
   * Stores an entry from elsewhere. Returns `false` if this author's `seq` is already
   * held, so a duplicate (or a clashing entry from a broken peer) changes nothing. An
   * entry ahead of a gap is kept but doesn't move the vector until the gap is filled.
   */
  add(entry: Entry): boolean {
    const author = entry.op.id.replica;
    let mine = this.#entries.get(author);
    if (mine === undefined) {
      mine = new Map();
      this.#entries.set(author, mine);
    }
    if (mine.has(entry.seq)) return false;
    mine.set(entry.seq, entry);
    let run = this.#vector.get(author) ?? 0;
    while (mine.has(run + 1)) run += 1;
    if (run > 0) this.#vector.set(author, run);
    return true;
  }

  /** The version vector: each author's unbroken run, as a copy. */
  vector(): VersionVector {
    return new Map(this.#vector);
  }

  /**
   * Every entry the side with vector `theirs` lacks, sorted by author and then `seq`, so
   * each author's ops are sent in the order they were made. Entries ahead of a gap here
   * are included too: the other side may be missing them.
   */
  missing(theirs: VersionVector): Entry[] {
    const out: Entry[] = [];
    for (const author of [...this.#entries.keys()].sort()) {
      const have = theirs.get(author) ?? 0;
      const mine = this.#entries.get(author) ?? new Map<number, Entry>();
      const seqs = [...mine.keys()].filter((seq) => seq > have).sort((a, b) => a - b);
      for (const seq of seqs) {
        const entry = mine.get(seq);
        if (entry !== undefined) out.push(entry);
      }
    }
    return out;
  }

  /** Every entry held, in the same order as `missing`. */
  entries(): Entry[] {
    return this.missing(new Map());
  }

  /** How many entries are held. */
  get size(): number {
    let total = 0;
    for (const mine of this.#entries.values()) total += mine.size;
    return total;
  }
}
