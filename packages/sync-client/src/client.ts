import { DecodeError, FastFugue, type FugueOp, type ReplicaId } from "@crdt-notes/crdt";
import {
  decodeMessage,
  encodeMessage,
  OpLog,
  type Entry,
  type Message,
} from "@crdt-notes/sync-protocol";
import { Storage } from "./storage.js";

export interface ClientOptions {
  /** The document's name, shared by every device editing it. */
  readonly doc: string;
  /** The sync server, like `wss://notes.example/sync`. */
  readonly url: string;
  /** Where to save. Defaults to the browser's `indexedDB`. */
  readonly indexedDB?: IDBFactory;
  /** How to open a socket. Defaults to the global `WebSocket` (browsers, Node 22+). */
  readonly WebSocket?: new (url: string) => WebSocket;
  /** Save a snapshot after this many new entries. Default 1000. */
  readonly snapshotEvery?: number;
  /** Wait this long before reconnecting after the connection drops. Default 1000 ms. */
  readonly reconnectDelayMs?: number;
}

/**
 * One document on one device (ADR-0010): a `FastFugue` replica that saves every op to
 * IndexedDB and syncs with the server whenever it is online. Edits work the same
 * offline; they are sent on the next connect.
 *
 * Two rules keep it safe if the tab is killed at any moment:
 * - **An op is saved before it is sent.** Otherwise a reload could hand a new op the
 *   same ID and `seq` as one the server already has, and the server would ignore it.
 * - **A snapshot is saved in the same transaction as the entries it includes,** so a
 *   reload never finds a snapshot holding an edit that its op log doesn't.
 *
 * @example Alice edits on a train, offline. Bob edits at his desk. When Alice gets a
 * signal, both documents converge:
 * ```ts
 * const alice = await SyncClient.open({ doc: "notes", url });
 * alice.insertAt(0, "a");          // saved locally, no server needed
 * const bob = await SyncClient.open({ doc: "notes", url });
 * bob.connect();
 * bob.insertAt(0, "b");
 * alice.connect();                 // sends "a", receives "b"
 * // soon: alice.text() === bob.text(), "ab" or "ba" on both
 * ```
 */
export class SyncClient {
  readonly replica: ReplicaId;
  readonly #options: ClientOptions;
  readonly #doc: FastFugue;
  readonly #log: OpLog;
  readonly #storage: Storage;
  readonly #listeners = new Set<() => void>();

  /** Entries not yet handed to a write. */
  readonly #unsaved: Entry[] = [];
  /** Entries whose write hasn't committed yet: never sent. */
  readonly #notSaved = new Set<Entry>();
  /** The chain of writes, one after another. */
  #writes: Promise<void> = Promise.resolve();
  #sinceSnapshot = 0;
  /** Why the last write failed, until one succeeds. */
  #failure: unknown = null;

  #socket: WebSocket | null = null;
  /** Past the handshake, so new local entries go straight to the server. */
  #live = false;
  /** `connect()` was called and `disconnect()` wasn't: keep reconnecting. */
  #wantOnline = false;
  #retry: ReturnType<typeof setTimeout> | null = null;

  private constructor(
    options: ClientOptions,
    replica: ReplicaId,
    doc: FastFugue,
    log: OpLog,
    storage: Storage,
  ) {
    this.#options = options;
    this.replica = replica;
    this.#doc = doc;
    this.#log = log;
    this.#storage = storage;
  }

  /**
   * Opens the document from local storage: the latest snapshot, then the saved entries
   * it doesn't include. A device with nothing saved gets a new random replica ID
   * (ADR-0008 item 7). Starts offline; call `connect()` to sync.
   */
  static async open(options: ClientOptions): Promise<SyncClient> {
    const factory = options.indexedDB ?? globalThis.indexedDB;
    const storage = await Storage.open(factory, options.doc);
    const saved = await storage.load();
    let replica = saved.replica;
    if (replica === null) {
      replica = crypto.randomUUID();
      await storage.setReplica(replica);
    }
    const doc =
      saved.snapshot === null
        ? new FastFugue(replica)
        : FastFugue.load(replica, saved.snapshot.text);
    const log = new OpLog();
    const covered = saved.snapshot?.vector ?? new Map<ReplicaId, number>();
    for (const entry of saved.entries) {
      log.add(entry);
      if (entry.seq > (covered.get(entry.op.id.replica) ?? 0)) doc.apply(entry.op);
    }
    return new SyncClient(options, replica, doc, log, storage);
  }

  /** The visible document. */
  text(): string {
    return this.#doc.text();
  }

  /** Every item, tombstones included, in document order. */
  items(): ReturnType<FastFugue["items"]> {
    return this.#doc.items();
  }

  /** Inserts `char` so it becomes the visible character at `index`. */
  insertAt(index: number, char: string): void {
    this.#local(this.#doc.insertAt(index, char));
  }

  /** Deletes the visible character at `index`. */
  deleteAt(index: number): void {
    this.#local(this.#doc.deleteAt(index));
  }

  /** Calls `listener` after every change, local or remote. Returns an unsubscribe. */
  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Goes online, and stays online: reconnects whenever the connection drops. */
  connect(): void {
    this.#wantOnline = true;
    if (this.#socket === null && this.#retry === null) this.#open();
  }

  /** Goes offline. Edits keep working and are sent on the next `connect()`. */
  disconnect(): void {
    this.#wantOnline = false;
    if (this.#retry !== null) clearTimeout(this.#retry);
    this.#retry = null;
    this.#socket?.close();
  }

  /** Whether the handshake with the server has finished on the current connection. */
  get live(): boolean {
    return this.#live;
  }

  /**
   * Resolves once every change made so far is saved. If saving fails, it tries again
   * and rejects with the error if that fails too.
   */
  async saved(): Promise<void> {
    for (let tries = 0; ; tries += 1) {
      await this.#writes;
      if (this.#unsaved.length === 0 && this.#notSaved.size === 0) return;
      if (this.#failure !== null && tries > 0) throw this.#failure;
      this.#writes = this.#writes.then(() => this.#flush());
    }
  }

  /** Goes offline, finishes saving, and closes the database. */
  async close(): Promise<void> {
    this.disconnect();
    try {
      await this.saved();
    } finally {
      this.#storage.close();
    }
  }

  #local(op: FugueOp): void {
    this.#added([this.#log.append(op)]);
  }

  /** Entries just added to the log and the document: save them, then tell listeners. */
  #added(entries: readonly Entry[]): void {
    for (const entry of entries) {
      this.#unsaved.push(entry);
      this.#notSaved.add(entry);
    }
    this.#writes = this.#writes.then(() => this.#flush());
    for (const listener of this.#listeners) listener();
  }

  async #flush(): Promise<void> {
    const entries = this.#unsaved.splice(0);
    if (entries.length === 0) return;
    const before = this.#sinceSnapshot;
    this.#sinceSnapshot += entries.length;
    let snapshot = null;
    if (this.#sinceSnapshot >= (this.#options.snapshotEvery ?? 1000)) {
      // Taken now, with everything in the log so far either already saved or in this
      // write, so the snapshot never holds an edit the saved log lacks.
      snapshot = { text: this.#doc.snapshot(), vector: this.#log.vector() };
      this.#sinceSnapshot = 0;
    }
    try {
      await this.#storage.write(entries, snapshot);
    } catch (error) {
      // Not saved, so not sent. Put them back to be retried with the next write.
      console.error("crdt-notes: saving failed", error);
      this.#unsaved.unshift(...entries);
      this.#sinceSnapshot = before + entries.length;
      this.#failure = error;
      return;
    }
    this.#failure = null;
    for (const entry of entries) this.#notSaved.delete(entry);
    const mine = entries.filter((entry) => entry.op.id.replica === this.replica);
    if (this.#live && mine.length > 0) this.#send({ type: "ops", entries: mine });
  }

  #open(): void {
    this.#retry = null;
    const Socket = this.#options.WebSocket ?? globalThis.WebSocket;
    const socket = new Socket(this.#options.url);
    this.#socket = socket;
    socket.onopen = () => {
      this.#send({ type: "hello", doc: this.#options.doc, vector: this.#log.vector() });
    };
    socket.onmessage = (event: MessageEvent) => {
      this.#receive(String(event.data));
    };
    socket.onclose = () => {
      if (this.#socket !== socket) return;
      this.#socket = null;
      this.#live = false;
      if (this.#wantOnline)
        this.#retry = setTimeout(
          () => this.#open(),
          this.#options.reconnectDelayMs ?? 1000,
        );
    };
    // An error is always followed by a close, which does the cleanup.
    socket.onerror = () => undefined;
  }

  #receive(text: string): void {
    let message: Message;
    try {
      message = decodeMessage(text);
    } catch (error) {
      if (!(error instanceof DecodeError)) throw error;
      this.#socket?.close();
      return;
    }
    if (message.type === "welcome") {
      this.#live = true;
      // Unsaved entries are left out: their write sends them once it commits.
      const missing = this.#log
        .missing(message.vector)
        .filter((entry) => !this.#notSaved.has(entry));
      if (missing.length > 0) this.#send({ type: "ops", entries: missing });
      return;
    }
    if (message.type !== "ops") {
      this.#socket?.close();
      return;
    }
    const fresh = message.entries.filter((entry) => this.#log.add(entry));
    for (const entry of fresh) this.#doc.apply(entry.op);
    if (fresh.length > 0) this.#added(fresh);
  }

  #send(message: Message): void {
    if (this.#socket?.readyState === 1) this.#socket.send(encodeMessage(message));
  }
}
