import { describe, expect, it } from "vitest";
import { DecodeError, decodeOp, encodeOp } from "./encoding.js";
import { FastFugue } from "./fast-fugue.js";
import { Fugue } from "./fugue.js";

const insert =
  '{"v":1,"kind":"insert","id":{"counter":3,"replica":"A"},"char":"x","parent":{"counter":1,"replica":"B"},"side":"left"}';
const del =
  '{"v":1,"kind":"delete","id":{"counter":4,"replica":"A"},"target":{"counter":3,"replica":"A"}}';

/** `insert` with one change made to its parsed JSON object. */
function changed(change: (op: Record<string, unknown>) => void): string {
  const op = JSON.parse(insert) as Record<string, unknown>;
  change(op);
  return JSON.stringify(op);
}

describe("encodeOp and decodeOp", () => {
  it("write the documented JSON and read it back", () => {
    const op = decodeOp(insert);
    expect(op).toEqual({
      kind: "insert",
      id: { counter: 3, replica: "A" },
      char: "x",
      parent: { counter: 1, replica: "B" },
      side: "left",
    });
    expect(encodeOp(op)).toBe(insert);
    expect(encodeOp(decodeOp(del))).toBe(del);
  });

  it("write only the op's own fields", () => {
    const op = { ...decodeOp(del), extra: "not sent" };
    expect(encodeOp(op)).toBe(del);
  });

  const rejected: [string, string][] = [
    ["invalid JSON", "{"],
    ["a JSON value that isn't an object", "[1]"],
    ["a missing version", changed((op) => delete op["v"])],
    ["another version", changed((op) => (op["v"] = 2))],
    ["an unknown kind", changed((op) => (op["kind"] = "move"))],
    ["an unknown extra field", changed((op) => (op["bold"] = true))],
    ["a missing field", changed((op) => delete op["side"])],
    ["a counter of 0", changed((op) => (op["id"] = { counter: 0, replica: "A" }))],
    [
      "a fractional counter",
      changed((op) => (op["id"] = { counter: 1.5, replica: "A" })),
    ],
    [
      "a counter above 2^53 - 1",
      changed((op) => (op["id"] = { counter: 2 ** 53, replica: "A" })),
    ],
    [
      "a replica that isn't a string",
      changed((op) => (op["id"] = { counter: 1, replica: 7 })),
    ],
    [
      "an ID with an extra field",
      changed((op) => (op["id"] = { counter: 1, replica: "A", x: 1 })),
    ],
    ["an empty char", changed((op) => (op["char"] = ""))],
    ["an unknown side", changed((op) => (op["side"] = "up"))],
    ["a left child of the start", changed((op) => (op["parent"] = null))],
    ["delete fields on an insert", changed((op) => (op["kind"] = "delete"))],
  ];
  for (const [what, text] of rejected) {
    it(`reject ${what} with a DecodeError`, () => {
      expect(() => decodeOp(text)).toThrow(DecodeError);
    });
  }

  it("reject a prototype-polluting field instead of copying it", () => {
    expect(() =>
      decodeOp(insert.replace('"v":1,', '"v":1,"__proto__":{"x":1},')),
    ).toThrow(DecodeError);
  });
});

describe.each([Fugue, FastFugue])("%o snapshots", (Impl) => {
  it("reload to the same items, clock and held-back ops", () => {
    const alice = new Impl("A");
    const bob = new Impl("B");
    for (const op of [alice.insertAt(0, "a"), alice.insertAt(1, "b"), alice.deleteAt(0)])
      bob.apply(op);
    const early = alice.insertAt(1, "c");
    bob.apply(alice.insertAt(2, "d")); // arrives before its parent "c", so it is held
    const reloaded = Impl.load("B", bob.snapshot());
    expect(reloaded.items()).toEqual(bob.items());
    expect(reloaded.pendingCount).toBe(1);
    expect(reloaded.snapshot()).toBe(bob.snapshot());
    reloaded.apply(early);
    bob.apply(early);
    expect(reloaded.text()).toBe("bcd");
    // The clock came back too: both pick the same next ID.
    expect(reloaded.insertAt(0, "z")).toEqual(bob.insertAt(0, "z"));
  });

  it("keep the clock past a delete, which leaves no node behind", () => {
    const alice = new Impl("A");
    alice.insertAt(0, "a"); // counter 1
    alice.deleteAt(0); // counter 2, only in the clock
    expect(Impl.load("A", alice.snapshot()).insertAt(0, "b").id.counter).toBe(3);
  });

  it("load a snapshot from the other implementation", () => {
    const other = Impl === Fugue ? FastFugue : Fugue;
    const doc = new other("A");
    for (const char of "hello") doc.insertAt(0, char);
    expect(Impl.load("A", doc.snapshot()).text()).toBe("olleh");
  });

  const snapshot = (nodes: unknown[], clock = 5, pending: unknown[] = []): string =>
    JSON.stringify({ v: 1, clock, nodes, pending });
  const node = (counter: number, parent: number | null) => ({
    id: { counter, replica: "A" },
    char: "x",
    parent: parent === null ? null : { counter: parent, replica: "A" },
    side: "right",
    deleted: false,
  });
  const rejected: [string, string][] = [
    ["invalid JSON", "nope"],
    ["another version", JSON.stringify({ v: 2, clock: 1, nodes: [], pending: [] })],
    ["a child listed before its parent", snapshot([node(2, 1), node(1, null)])],
    ["a node whose parent is missing", snapshot([node(2, 1)])],
    ["the same node twice", snapshot([node(1, null), node(1, null)])],
    ["a clock below a node's counter", snapshot([node(1, null), node(2, 1)], 1)],
    [
      "a node without its deleted flag",
      snapshot([{ ...node(1, null), deleted: undefined }]),
    ],
    ["a malformed pending op", snapshot([], 5, [{ kind: "insert" }])],
  ];
  for (const [what, text] of rejected) {
    it(`reject ${what} with a DecodeError`, () => {
      expect(() => Impl.load("A", text)).toThrow(DecodeError);
    });
  }
});
