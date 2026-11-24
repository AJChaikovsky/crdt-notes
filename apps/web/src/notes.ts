/**
 * The list of notes on this device (ADR-0013). It is a cache for the home screen, not part
 * of any note: each note's text lives in its own IndexedDB database (ADR-0010), and this
 * one only remembers which notes were opened here, when, and what their first line said.
 */

/** One note in the list. */
export interface NoteEntry {
  /** The note's document name, which is also what follows `#` in its link. */
  readonly id: string;
  /** Its first line when last seen on this device, or "" if it was empty. */
  readonly title: string;
  /** When it was last opened here, in milliseconds since 1970. */
  readonly openedAt: number;
}

const STORE = "notes";

/** Letters and digits that can't be misread for each other (no 0/o, 1/l). */
const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

/**
 * A random name for a new note: 16 characters from 32, so 80 random bits. With no
 * accounts, the link is the only key to a note, so it must be impossible to guess.
 */
export function newNoteId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => ALPHABET[byte % 32] ?? "a").join("");
}

/** A note's title: its first non-blank line, without markdown heading marks, cut to 80. */
export function titleOf(text: string): string {
  for (const line of text.split("\n")) {
    const title = line.replace(/^\s*#{1,6}\s+/, "").trim();
    if (title !== "") return title.length > 80 ? `${title.slice(0, 79)}…` : title;
  }
  return "";
}

export class NoteIndex {
  readonly #db: IDBDatabase;

  private constructor(db: IDBDatabase) {
    this.#db = db;
  }

  static async open(factory: IDBFactory = indexedDB): Promise<NoteIndex> {
    // Not "crdt-notes:…", so it can never clash with a note's own database.
    const request = factory.open("crdt-notes-index", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore(STORE, { keyPath: "id" });
    return new NoteIndex(await done(request));
  }

  /** Every note opened on this device, most recently opened first. */
  async list(): Promise<NoteEntry[]> {
    const tx = this.#db.transaction(STORE, "readonly");
    const rows = (await done(tx.objectStore(STORE).getAll())) as unknown[];
    return rows
      .filter(isEntry)
      .sort((a, b) => b.openedAt - a.openedAt || (a.id < b.id ? -1 : 1));
  }

  /** Records that a note was just opened, keeping its title if `title` is left out. */
  async opened(id: string, title?: string, now = Date.now()): Promise<void> {
    await this.#update(id, (old) => ({
      id,
      title: title ?? old?.title ?? "",
      openedAt: now,
    }));
  }

  /** Updates a note's title, keeping when it was opened. */
  async retitle(id: string, title: string): Promise<void> {
    await this.#update(id, (old) => ({
      id,
      title,
      openedAt: old?.openedAt ?? Date.now(),
    }));
  }

  /** Read and write in one transaction, so two updates can't undo each other. */
  async #update(id: string, change: (old: NoteEntry | null) => NoteEntry): Promise<void> {
    const tx = this.#db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const request = store.get(id);
    request.onsuccess = () => {
      const old: unknown = request.result;
      store.put(change(isEntry(old) ? old : null));
    };
    await committed(tx);
  }

  close(): void {
    this.#db.close();
  }
}

function isEntry(value: unknown): value is NoteEntry {
  if (typeof value !== "object" || value === null) return false;
  const { id, title, openedAt } = value as Record<string, unknown>;
  return (
    typeof id === "string" && typeof title === "string" && typeof openedAt === "number"
  );
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
