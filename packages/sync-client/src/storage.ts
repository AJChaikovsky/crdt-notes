import type { ReplicaId } from "@crdt-notes/crdt";
import {
  decodeEntry,
  encodeEntry,
  type Entry,
  type VersionVector,
} from "@crdt-notes/sync-protocol";

/** What a device has saved for one document. */
export interface Saved {
  /** This device's replica ID for the document, or `null` if nothing was ever saved. */
  readonly replica: ReplicaId | null;
  /** The latest snapshot, and the vector of entries it already includes. */
  readonly snapshot: { readonly text: string; readonly vector: VersionVector } | null;
  /** Every entry, in author and then `seq` order. */
  readonly entries: readonly Entry[];
}

const ENTRIES = "entries";
const META = "meta";

/**
 * One document's saved state in IndexedDB (the browser's built-in local database), as
 * ADR-0010 lays it out: a database per document with two object stores.
 * - `entries`: every entry, keyed by `[author, seq]`, as `encodeEntry` text.
 * - `meta`: the replica ID under `"replica"`, and the latest snapshot under `"snapshot"`.
 *
 * A write is one IndexedDB transaction, which either lands completely or not at all,
 * even if the tab is killed halfway.
 */
export class Storage {
  readonly #db: IDBDatabase;

  private constructor(db: IDBDatabase) {
    this.#db = db;
  }

  static async open(factory: IDBFactory, doc: string): Promise<Storage> {
    const request = factory.open(`crdt-notes:${doc}`, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(ENTRIES);
      request.result.createObjectStore(META);
    };
    return new Storage(await done(request));
  }

  async load(): Promise<Saved> {
    const tx = this.#db.transaction([ENTRIES, META], "readonly");
    const meta = tx.objectStore(META);
    const [replica, snapshot, lines] = await Promise.all([
      done(meta.get("replica")),
      done(meta.get("snapshot")),
      done(tx.objectStore(ENTRIES).getAll()),
    ]);
    return {
      replica: typeof replica === "string" ? replica : null,
      snapshot: readSnapshot(snapshot),
      entries: (lines as unknown[]).map((line) => decodeEntry(String(line))),
    };
  }

  /** Saves the replica ID chosen for this device. */
  async setReplica(replica: ReplicaId): Promise<void> {
    const tx = this.#db.transaction(META, "readwrite");
    tx.objectStore(META).put(replica, "replica");
    await committed(tx);
  }

  /**
   * Saves entries, and optionally a snapshot that includes them, in one transaction.
   * The snapshot's `vector` must only cover entries that are saved by the time this
   * transaction commits.
   */
  async write(
    entries: readonly Entry[],
    snapshot: { readonly text: string; readonly vector: VersionVector } | null,
  ): Promise<void> {
    const tx = this.#db.transaction([ENTRIES, META], "readwrite");
    const store = tx.objectStore(ENTRIES);
    for (const entry of entries)
      store.put(encodeEntry(entry), [entry.op.id.replica, entry.seq]);
    if (snapshot !== null)
      tx.objectStore(META).put(
        { text: snapshot.text, vector: [...snapshot.vector] },
        "snapshot",
      );
    await committed(tx);
  }

  close(): void {
    this.#db.close();
  }
}

/** A snapshot record as saved, or `null` if there is none or it is unreadable. */
function readSnapshot(value: unknown): Saved["snapshot"] {
  if (typeof value !== "object" || value === null) return null;
  const { text, vector } = value as { text?: unknown; vector?: unknown };
  if (typeof text !== "string" || !Array.isArray(vector)) return null;
  const pairs = new Map<ReplicaId, number>();
  for (const pair of vector as unknown[]) {
    if (!Array.isArray(pair)) return null;
    const [replica, seq] = pair as unknown[];
    if (typeof replica !== "string" || typeof seq !== "number") return null;
    pairs.set(replica, seq);
  }
  return { text, vector: pairs };
}

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function committed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}
