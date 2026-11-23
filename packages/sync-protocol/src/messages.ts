import {
  DecodeError,
  FORMAT_VERSION,
  opFromValue,
  opToValue,
  type ReplicaId,
} from "@crdt-notes/crdt";
import type { Entry, VersionVector } from "./log.js";

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
  | { readonly type: "ops"; readonly entries: readonly Entry[] };

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
  if (type !== "ops") fail(`message.type must be "hello", "welcome" or "ops"`);
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
