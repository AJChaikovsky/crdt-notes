import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  DecodeError,
  decodeOp,
  encodeOp,
  FastFugue,
  Fugue,
  type FugueOp,
  type Id,
} from "@crdt-notes/crdt";
import { asFugueDoc, fastFugue } from "./implementation.js";
import { propertyParameters } from "./property.js";
import { run, scenario } from "./scenario.js";

const id: fc.Arbitrary<Id> = fc.record({
  counter: fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }),
  replica: fc.string({ unit: "binary" }),
});

/** Any valid op, including replica strings and characters no scenario would use. */
const anyOp: fc.Arbitrary<FugueOp> = fc.oneof(
  fc
    .record({
      kind: fc.constant("insert" as const),
      id,
      char: fc.string({ unit: "binary", minLength: 1, maxLength: 4 }),
      parent: fc.option(id, { nil: null }),
      side: fc.constantFrom("left" as const, "right" as const),
    })
    .map((op) => (op.parent === null ? { ...op, side: "right" as const } : op)),
  fc.record({ kind: fc.constant("delete" as const), id, target: id }),
);

/** A valid op's JSON object with one thing broken, added or swapped, maybe in an ID. */
const mutated: fc.Arbitrary<string> = fc
  .tuple(
    anyOp,
    fc.constantFrom("v", "kind", "id", "char", "parent", "side", "target", "extra"),
    fc.constantFrom("drop", "set", "nested"),
    fc.jsonValue(),
  )
  .map(([op, field, how, value]) => {
    const object = JSON.parse(encodeOp(op)) as Record<string, unknown>;
    if (how === "drop") Reflect.deleteProperty(object, field);
    else if (how === "set") object[field] = value;
    else {
      const inner = object[field];
      if (typeof inner === "object" && inner !== null)
        (inner as Record<string, unknown>)["counter"] = value;
      else object[field] = { counter: value, replica: "A" };
    }
    return JSON.stringify(object);
  });

/** Random text a decoder could be handed by a broken disk or a hostile peer. */
const garbage: fc.Arbitrary<string> = fc.oneof(
  fc.string({ unit: "binary" }),
  fc.uint8Array({ maxLength: 200 }).map((bytes) => new TextDecoder().decode(bytes)),
  fc.jsonValue().map((value) => JSON.stringify(value)),
  mutated,
);

/** Calls `decode`; any error other than `DecodeError` fails the property. */
function decodeOrReject<T>(decode: () => T): T | DecodeError {
  try {
    return decode();
  } catch (error) {
    expect(error).toBeInstanceOf(DecodeError);
    return error as DecodeError;
  }
}

describe("P8: serialization round-trip", () => {
  it("decodes every op a scenario sends to an equal op", () => {
    fc.assert(
      fc.property(scenario(), (s) => {
        for (const { op } of run(fastFugue, s).log())
          expect(decodeOp(encodeOp(op))).toEqual(op);
      }),
      propertyParameters(),
    );
  });

  it("decodes any valid op to an equal op, whatever its strings and counters", () => {
    fc.assert(
      fc.property(anyOp, (op) => {
        expect(decodeOp(encodeOp(op))).toEqual(op);
      }),
      propertyParameters(),
    );
  });

  it("rejects random input with a DecodeError, or reads an op that round-trips", () => {
    fc.assert(
      fc.property(garbage, (text) => {
        const op = decodeOrReject(() => decodeOp(text));
        if (!(op instanceof DecodeError)) expect(decodeOp(encodeOp(op))).toEqual(op);
      }),
      propertyParameters(),
    );
  });

  it("rejects broken snapshots with a DecodeError, the same way in both implementations", () => {
    // A real snapshot with one node or the clock tampered with, or plain garbage.
    const snapshotText = fc.oneof(
      garbage,
      fc
        .tuple(
          scenario(),
          fc.nat(),
          fc.constantFrom("drop", "swap", "clock", "set"),
          fc.jsonValue(),
        )
        .map(([s, pick, how, value]) => {
          const snapshot = JSON.parse(
            asFugueDoc(run(fastFugue, s).doc(0)).snapshot(),
          ) as {
            clock: unknown;
            nodes: unknown[];
          };
          const at = pick % Math.max(snapshot.nodes.length, 1);
          if (how === "drop") snapshot.nodes.splice(at, 1);
          else if (how === "swap") snapshot.nodes.reverse();
          else if (how === "clock") snapshot.clock = value;
          else snapshot.nodes[at] = value;
          return JSON.stringify(snapshot);
        }),
    );
    fc.assert(
      fc.property(snapshotText, (text) => {
        const slow = decodeOrReject(() => Fugue.load("Z", text));
        const fast = decodeOrReject(() => FastFugue.load("Z", text));
        expect(fast instanceof DecodeError).toBe(slow instanceof DecodeError);
        if (!(slow instanceof DecodeError) && !(fast instanceof DecodeError))
          expect(fast.items()).toEqual(slow.items());
      }),
      propertyParameters(),
    );
  });
});
