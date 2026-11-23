import type { FugueInsertOp, FugueOp } from "./fugue.js";
import { compareIds, type Id } from "./id.js";

/**
 * The format version written into every encoded op and snapshot (ADR-0007). A decoder
 * rejects any other version rather than guessing what it means.
 */
export const FORMAT_VERSION = 1;

/**
 * Thrown by `decodeOp` and by `Fugue.load` / `FastFugue.load` for input that isn't a
 * valid op or snapshot of this version. The decoders never throw anything else, so a
 * caller can catch this one type and drop or quarantine the bad record.
 */
export class DecodeError extends Error {
  override readonly name = "DecodeError";
}

/** One character in a snapshot: its insert op's fields, plus whether it was deleted. */
export interface SnapshotNode {
  readonly id: Id;
  readonly char: string;
  readonly parent: Id | null;
  readonly side: "left" | "right";
  readonly deleted: boolean;
}

/** A replica's whole state, as `Fugue` and `FastFugue` save and load it (ADR-0007). */
export interface SnapshotData {
  /** The replica's Lamport clock counter. */
  readonly clock: number;
  /** Every character ever inserted, tombstones included, each after its parent. */
  readonly nodes: readonly SnapshotNode[];
  /** Ops held back waiting for their parent or target, in arrival order. */
  readonly pending: readonly FugueOp[];
}

/**
 * Turns an op into text to store or send: JSON with a version number (ADR-0007).
 * `decodeOp` turns it back into an equal op.
 *
 * @example Bob's insert crosses the network as text, and Alice applies it as usual:
 * ```ts
 * const op = bob.insertAt(0, "x");
 * const wire = encodeOp(op);
 * // '{"v":1,"kind":"insert","id":{"counter":1,"replica":"B"},"char":"x","parent":null,"side":"right"}'
 * alice.apply(decodeOp(wire)); // same as alice.apply(op)
 * ```
 */
export function encodeOp(op: FugueOp): string {
  return JSON.stringify({ v: FORMAT_VERSION, ...opToValue(op) });
}

/**
 * Reads an op written by `encodeOp`. Checks every field and throws `DecodeError` for
 * anything else: invalid JSON, another version, a missing, extra or malformed field
 * (ADR-0007). It never throws any other error, whatever the input.
 *
 * @example A corrupted record is rejected instead of becoming a wrong edit:
 * ```ts
 * decodeOp('{"v":1,"kind":"delete","id":{"counter":0,"replica":"A"},"target":{"counter":1,"replica":"A"}}');
 * // throws DecodeError: counter must be a whole number from 1 to 2^53 - 1
 * ```
 */
export function decodeOp(text: string): FugueOp {
  const value = record(parse(text), "op");
  version(value);
  return readOp(value, "op", ["v"]);
}

/**
 * Reads an op written by `opToValue` (already parsed from JSON), with the same checks
 * as `decodeOp`. Throws `DecodeError`.
 */
export function opFromValue(value: unknown): FugueOp {
  return readOp(record(value, "op"), "op", []);
}

/** Turns a replica's state into text. Used by `Fugue.snapshot` and `FastFugue.snapshot`. */
export function encodeSnapshot(data: SnapshotData): string {
  return JSON.stringify({
    v: FORMAT_VERSION,
    clock: data.clock,
    nodes: data.nodes.map((node) => ({
      id: idObject(node.id),
      char: node.char,
      parent: node.parent === null ? null : idObject(node.parent),
      side: node.side,
      deleted: node.deleted,
    })),
    pending: data.pending.map(opToValue),
  });
}

/**
 * Reads a snapshot written by `encodeSnapshot`, with the same checks as `decodeOp` on
 * every node and pending op, plus: each node's parent appears before it, no two nodes
 * share an ID, and the clock is at least every counter in the snapshot. Throws
 * `DecodeError` otherwise.
 */
export function decodeSnapshot(text: string): SnapshotData {
  const value = record(parse(text), "snapshot");
  version(value);
  exactKeys(value, ["v", "clock", "nodes", "pending"], "snapshot");
  // A replica that has seen nothing yet has a clock of 0.
  const clock = value["clock"] === 0 ? 0 : counter(value["clock"], "snapshot.clock");

  const seen = new Set<string>();
  const nodes = list(value["nodes"], "snapshot.nodes").map((item, i) => {
    const where = `snapshot.nodes[${i}]`;
    const node = readNode(record(item, where), where);
    if (node.parent !== null && !seen.has(key(node.parent)))
      fail(`${where}: its parent is not listed before it`);
    if (seen.has(key(node.id))) fail(`${where}: the same ID appears twice`);
    seen.add(key(node.id));
    if (node.id.counter > clock) fail(`${where}: counter is above the clock`);
    return node;
  });

  const pending = list(value["pending"], "snapshot.pending").map((item, i) => {
    const where = `snapshot.pending[${i}]`;
    const op = readOp(record(item, where), where, []);
    if (op.id.counter > clock) fail(`${where}: counter is above the clock`);
    return op;
  });
  // Pending ops are a buffer of distinct ops (P2 keeps duplicates out of it).
  for (let i = 1; i < pending.length; i += 1) {
    const op = pending[i];
    if (
      op !== undefined &&
      pending.slice(0, i).some((p) => compareIds(p.id, op.id) === 0)
    )
      fail(`snapshot.pending[${i}]: the same ID appears twice`);
  }
  return { clock, nodes, pending };
}

/**
 * An op as a plain JSON-ready object, without the version field: for formats that nest
 * ops inside a bigger versioned value, like a snapshot or a sync message. `opFromValue`
 * reads it back.
 */
export function opToValue(op: FugueOp): Record<string, unknown> {
  if (op.kind === "delete")
    return { kind: "delete", id: idObject(op.id), target: idObject(op.target) };
  return {
    kind: "insert",
    id: idObject(op.id),
    char: op.char,
    parent: op.parent === null ? null : idObject(op.parent),
    side: op.side,
  };
}

// Built field by field, so the key order is fixed and no stray property is written.
function idObject(id: Id): { counter: number; replica: string } {
  return { counter: id.counter, replica: id.replica };
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

function key(id: Id): string {
  return `${id.counter}:${id.replica}`;
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

/** The object has exactly these fields: an unknown one means a format we don't know. */
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

function version(value: Record<string, unknown>): void {
  if (value["v"] !== FORMAT_VERSION)
    fail(`unsupported version ${JSON.stringify(value["v"]) ?? "(missing)"}`);
}

function counter(value: unknown, where: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)
    fail(`${where}: counter must be a whole number from 1 to 2^53 - 1`);
  return value;
}

function readId(value: unknown, where: string): Id {
  const object = record(value, where);
  exactKeys(object, ["counter", "replica"], where);
  const replica = object["replica"];
  if (typeof replica !== "string") fail(`${where}.replica must be a string`);
  return { counter: counter(object["counter"], `${where}.counter`), replica };
}

/** The fields an insert op and a snapshot node share. */
function readInsert(value: Record<string, unknown>, where: string): FugueInsertOp {
  const id = readId(value["id"], `${where}.id`);
  const char = value["char"];
  if (typeof char !== "string" || char.length === 0)
    fail(`${where}.char must be a non-empty string`);
  const parent =
    value["parent"] === null ? null : readId(value["parent"], `${where}.parent`);
  const side = value["side"];
  if (side !== "left" && side !== "right")
    fail(`${where}.side must be "left" or "right"`);
  // The start of the document only ever has right children.
  if (parent === null && side !== "right")
    fail(`${where}: an insert at the start must be on the right`);
  return { kind: "insert", id, char, parent, side };
}

function readOp(value: Record<string, unknown>, where: string, extra: string[]): FugueOp {
  const kind = value["kind"];
  if (kind === "delete") {
    exactKeys(value, [...extra, "kind", "id", "target"], where);
    return {
      kind: "delete",
      id: readId(value["id"], `${where}.id`),
      target: readId(value["target"], `${where}.target`),
    };
  }
  if (kind !== "insert") fail(`${where}.kind must be "insert" or "delete"`);
  exactKeys(value, [...extra, "kind", "id", "char", "parent", "side"], where);
  return readInsert(value, where);
}

function readNode(value: Record<string, unknown>, where: string): SnapshotNode {
  exactKeys(value, ["id", "char", "parent", "side", "deleted"], where);
  const deleted = value["deleted"];
  if (typeof deleted !== "boolean") fail(`${where}.deleted must be true or false`);
  const { id, char, parent, side } = readInsert(value, where);
  return { id, char, parent, side, deleted };
}
