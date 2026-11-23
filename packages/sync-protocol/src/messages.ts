import {
  DecodeError,
  FORMAT_VERSION,
  opFromValue,
  opToValue,
  type Id,
  type ReplicaId,
} from "@crdt-notes/crdt";
import type { Entry, VersionVector } from "./log.js";

/**
 * Where someone's selection is, as anchors (`FastFugue.anchorAt`) rather than indices,
 * so it stays put while others edit (ADR-0012). `anchor` is where the selection started
 * and `head` where the cursor is; they are equal for a plain cursor.
 */
export interface Selection {
  readonly anchor: Id | null;
  readonly head: Id | null;
}

/**
 * Everything a client and the server say to each other (ADR-0008). A session opens with
 * `hello` and `welcome`; after that, each side sends the other the entries its vector
 * lacks, then live edits, all as `ops`.
 */
export type Message =
  /** Client to server: open a session for document `doc`, holding `vector`. */
  | { readonly type: "hello"; readonly doc: string; readonly vector: VersionVector }
  /** Server to client: the session is open, and the server holds `vector`. */
  | { readonly type: "welcome"; readonly vector: VersionVector }
  /** Either way: entries the other side may not have. */
  | { readonly type: "ops"; readonly entries: readonly Entry[] }
  /**
   * Either way: where `replica`'s selection is now, or `null` once they have left. Relayed
   * to the document's other clients, never stored: presence isn't part of the document.
   */
  | {
      readonly type: "presence";
      readonly replica: ReplicaId;
      readonly selection: Selection | null;
    };

/**
 * Turns a message into versioned JSON text. A vector is written as `[replica, seq]`
 * pairs, never as an object keyed by replica, since a replica ID like `"__proto__"`
 * is a dangerous object key.
 *
 * @example Bob reconnects after typing offline. He says what he holds, the server
 * answers, and each sends the other what it lacks:
 * ```ts
 * socket.send(encodeMessage({ type: "hello", doc: "notes", vector: log.vector() }));
 * // server: {"v":1,"type":"welcome","vector":[["A",12]]}
 * const reply = decodeMessage(text);
 * if (reply.type === "welcome")
 *   socket.send(encodeMessage({ type: "ops", entries: log.missing(reply.vector) }));
 * ```
 */
export function encodeMessage(message: Message): string {
  const v = FORMAT_VERSION;
  switch (message.type) {
    case "hello":
      return JSON.stringify({
        v,
        type: "hello",
        doc: message.doc,
        vector: [...message.vector],
      });
    case "welcome":
      return JSON.stringify({ v, type: "welcome", vector: [...message.vector] });
    case "presence":
      return JSON.stringify({
        v,
        type: "presence",
        replica: message.replica,
        selection:
          message.selection === null
            ? null
            : {
                anchor: idValue(message.selection.anchor),
                head: idValue(message.selection.head),
              },
      });
    case "ops":
      return JSON.stringify({
        v,
        type: "ops",
        entries: message.entries.map(({ seq, op }) => ({ seq, op: opToValue(op) })),
      });
  }
}

/**
 * Reads a message written by `encodeMessage`, checking every field like `decodeOp`.
 * Throws `DecodeError` for anything else, and never any other error.
 */
export function decodeMessage(text: string): Message {
  const value = record(parse(text), "message");
  if (value["v"] !== FORMAT_VERSION) fail("unsupported version");
  const type = value["type"];
  if (type === "hello") {
    exactKeys(value, ["v", "type", "doc", "vector"], "hello");
    const doc = value["doc"];
    if (typeof doc !== "string") fail("hello.doc must be a string");
    return { type, doc, vector: readVector(value["vector"], "hello.vector") };
  }
  if (type === "welcome") {
    exactKeys(value, ["v", "type", "vector"], "welcome");
    return { type, vector: readVector(value["vector"], "welcome.vector") };
  }
  if (type === "presence") {
    exactKeys(value, ["v", "type", "replica", "selection"], "presence");
    const replica = value["replica"];
    if (typeof replica !== "string") fail("presence.replica must be a string");
    if (value["selection"] === null) return { type, replica, selection: null };
    const selection = record(value["selection"], "presence.selection");
    exactKeys(selection, ["anchor", "head"], "presence.selection");
    return {
      type,
      replica,
      selection: {
        anchor: readAnchor(selection["anchor"], "presence.selection.anchor"),
        head: readAnchor(selection["head"], "presence.selection.head"),
      },
    };
  }
  if (type !== "ops")
    fail(`message.type must be "hello", "welcome", "ops" or "presence"`);
  exactKeys(value, ["v", "type", "entries"], "ops");
  const entries = list(value["entries"], "ops.entries").map((item, i) => {
    const where = `ops.entries[${i}]`;
    const entry = record(item, where);
    exactKeys(entry, ["seq", "op"], where);
    return { seq: seq(entry["seq"], `${where}.seq`), op: opFromValue(entry["op"]) };
  });
  return { type, entries };
}

/**
 * One entry as a line of versioned JSON, for storing an op log as a file with one entry
 * per line (the server does). `decodeEntry` reads it back.
 */
export function encodeEntry({ seq, op }: Entry): string {
  return JSON.stringify({ v: FORMAT_VERSION, seq, op: opToValue(op) });
}

/** Reads a line written by `encodeEntry`. Throws `DecodeError` for anything else. */
export function decodeEntry(text: string): Entry {
  const value = record(parse(text), "entry");
  if (value["v"] !== FORMAT_VERSION) fail("unsupported version");
  exactKeys(value, ["v", "seq", "op"], "entry");
  return { seq: seq(value["seq"], "entry.seq"), op: opFromValue(value["op"]) };
}

function idValue(id: Id | null): { counter: number; replica: string } | null {
  return id === null ? null : { counter: id.counter, replica: id.replica };
}

function readAnchor(value: unknown, where: string): Id | null {
  if (value === null) return null;
  const id = record(value, where);
  exactKeys(id, ["counter", "replica"], where);
  const replica = id["replica"];
  if (typeof replica !== "string") fail(`${where}.replica must be a string`);
  return { counter: seq(id["counter"], `${where}.counter`), replica };
}

function readVector(value: unknown, where: string): VersionVector {
  const vector = new Map<ReplicaId, number>();
  list(value, where).forEach((pair, i) => {
    const items = list(pair, `${where}[${i}]`);
    const [replica, n] = items;
    if (items.length !== 2 || typeof replica !== "string")
      fail(`${where}[${i}] must be a [replica, seq] pair`);
    if (vector.has(replica)) fail(`${where}: replica ${replica} appears twice`);
    vector.set(replica, seq(n, `${where}[${i}]`));
  });
  return vector;
}

function fail(message: string): never {
  throw new DecodeError(message);
}

function parse(text: unknown): unknown {
  if (typeof text !== "string") fail("input must be a string");
  try {
    return JSON.parse(text);
  } catch {
    return fail("input is not valid JSON");
  }
}

function record(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    fail(`${where} must be an object`);
  return value as Record<string, unknown>;
}

function list(value: unknown, where: string): unknown[] {
  if (!Array.isArray(value)) fail(`${where} must be an array`);
  return value as unknown[];
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  where: string,
) {
  for (const field of Object.keys(value))
    if (!keys.includes(field)) fail(`${where}: unexpected field "${field}"`);
  for (const field of keys)
    if (!Object.hasOwn(value, field)) fail(`${where}: missing field "${field}"`);
}

function seq(value: unknown, where: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)
    fail(`${where} must be a whole number from 1 to 2^53 - 1`);
  return value;
}
