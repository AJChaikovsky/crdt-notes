import { DecodeError } from "@crdt-notes/crdt";
import {
  decodeMessage,
  encodeMessage,
  type Message,
  type OpLog,
} from "@crdt-notes/sync-protocol";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import { DocStore } from "./store.js";

/** The longest document name accepted, in characters. */
const MAX_DOC_NAME = 200;

/** A running sync server. */
export interface SyncServer {
  /** The port it listens on (useful when started on port 0, which picks a free one). */
  readonly port: number;
  /**
   * Stops it abruptly, like a crash: every connection is cut without a goodbye. What was
   * already saved stays on disk for the next start.
   */
  close(): Promise<void>;
}

export interface ServerOptions {
  /** Port to listen on; 0 picks a free one. */
  readonly port?: number;
  /** Folder for the documents' op logs. Created if missing. */
  readonly dataDir: string;
}

interface Doc {
  readonly log: OpLog;
  readonly clients: Set<WebSocket>;
}

/**
 * Starts the sync server (ADR-0009). It never looks inside the document: it keeps each
 * document's op log, catches each client up on connect, and relays new ops to the
 * document's other clients.
 *
 * A session, for one client and one document:
 * 1. The client sends `hello` with the document name and its version vector.
 * 2. The server answers `welcome` with its own vector, then `ops` with everything the
 *    client lacks.
 * 3. The client sends `ops` with everything the server lacks, then its edits as it makes
 *    them. The server saves each new entry and relays it to the document's other clients.
 *
 * Anything else (bad JSON, a second `hello`, `ops` before `hello`) closes the connection
 * with code 1008 (policy violation). The client reconnects and starts over.
 *
 * @example Alice edits offline while Bob is connected. When she reconnects, the server
 * sends her Bob's ops, she sends hers, and the server relays hers to Bob:
 * ```ts
 * const server = await startServer({ port: 0, dataDir: "/var/lib/crdt-notes" });
 * // alice → server: {"v":1,"type":"hello","doc":"notes","vector":[["A",3]]}
 * // server → alice: {"v":1,"type":"welcome","vector":[["A",1],["B",5]]}
 * // server → alice: {"v":1,"type":"ops","entries":[...Bob's ops 1 to 5...]}
 * // alice → server: {"v":1,"type":"ops","entries":[...Alice's ops 2 and 3...]}
 * // server → bob:   {"v":1,"type":"ops","entries":[...Alice's ops 2 and 3...]}
 * ```
 */
export async function startServer(options: ServerOptions): Promise<SyncServer> {
  const store = new DocStore(options.dataDir);
  const docs = new Map<string, Doc>();
  const wss = new WebSocketServer({ port: options.port ?? 0 });
  await new Promise<void>((resolve, reject) => {
    wss.once("listening", resolve);
    wss.once("error", reject);
  });

  const open = (name: string): Doc => {
    let doc = docs.get(name);
    if (doc === undefined) {
      doc = { log: store.load(name), clients: new Set() };
      docs.set(name, doc);
    }
    return doc;
  };

  wss.on("connection", (socket) => {
    let session: { name: string; doc: Doc } | null = null;
    const send = (message: Message): void => socket.send(encodeMessage(message));
    const reject = (reason: string): void => socket.close(1008, reason);

    socket.on("message", (data: RawData) => {
      let message: Message;
      try {
        message = decodeMessage(rawText(data));
      } catch (error) {
        if (error instanceof DecodeError) return reject("malformed message");
        throw error;
      }

      if (session === null) {
        if (message.type !== "hello") return reject("expected hello");
        if (message.doc.length === 0 || message.doc.length > MAX_DOC_NAME)
          return reject("bad document name");
        const doc = open(message.doc);
        session = { name: message.doc, doc };
        doc.clients.add(socket);
        send({ type: "welcome", vector: doc.log.vector() });
        const missing = doc.log.missing(message.vector);
        if (missing.length > 0) send({ type: "ops", entries: missing });
        return;
      }

      if (message.type !== "ops") return reject("unexpected message");
      const { name, doc } = session;
      const fresh = message.entries.filter((entry) => doc.log.add(entry));
      if (fresh.length === 0) return;
      store.append(name, fresh);
      const relay = encodeMessage({ type: "ops", entries: fresh });
      for (const other of doc.clients) if (other !== socket) other.send(relay);
    });

    socket.on("close", () => {
      session?.doc.clients.delete(socket);
    });
  });

  const address = wss.address();
  if (typeof address !== "object" || address === null)
    throw new Error("server has no port");

  return {
    port: address.port,
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of wss.clients) client.terminate();
        wss.close(() => resolve());
      }),
  };
}

/** A WebSocket message as text, however `ws` delivered it. */
function rawText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return data.toString("utf8");
}
