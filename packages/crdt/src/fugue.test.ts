import { describe, expect, it } from "vitest";
import { Fugue, type FugueInsertOp } from "./fugue.js";
import type { Id } from "./id.js";

/** Types `text` left to right after `origin` and returns the ops. */
function typeForward(
  replica: Fugue,
  text: string,
  origin: Id | null = null,
): FugueInsertOp[] {
  const ops: FugueInsertOp[] = [];
  let left = origin;
  for (const char of text) {
    const op = replica.insert(left, char);
    ops.push(op);
    left = op.id;
  }
  return ops;
}

/** Types `text` so it reads correctly, but one character at a time at `origin`'s spot. */
function typeBackward(
  replica: Fugue,
  text: string,
  origin: Id | null = null,
): FugueInsertOp[] {
  return [...text].reverse().map((char) => replica.insert(origin, char));
}

/** Delivers each replica's ops to the other, in the given order. */
function exchange(
  a: Fugue,
  aOps: FugueInsertOp[],
  b: Fugue,
  bOps: FugueInsertOp[],
): void {
  for (const op of bOps) a.apply(op);
  for (const op of aOps) b.apply(op);
}

describe("Fugue insert", () => {
  it("types left to right as a chain of right children", () => {
    const alice = new Fugue("A");
    const [h, i] = typeForward(alice, "Hi");
    expect(alice.text()).toBe("Hi");
    expect(i?.parent).toEqual(h?.id);
    expect(i?.side).toBe("right");
  });

  it("types backward as a chain of left children", () => {
    const alice = new Fugue("A");
    const [c, b, a] = typeBackward(alice, "abc");
    expect(alice.text()).toBe("abc");
    expect(c).toMatchObject({ parent: null, side: "right" });
    expect(b).toMatchObject({ parent: c?.id, side: "left" });
    expect(a).toMatchObject({ parent: b?.id, side: "left" });
  });

  it("inserts in the middle as a left child of the next character", () => {
    const alice = new Fugue("A");
    const [a, c] = typeForward(alice, "ac");
    if (a === undefined || c === undefined) throw new Error("unreachable");
    const b = alice.insert(a.id, "b"); // "a" already has a right child, "c"
    expect(b).toMatchObject({ parent: c.id, side: "left" });
    expect(alice.text()).toBe("abc");
  });

  it("does not interleave two backward runs, in either delivery order", () => {
    for (const order of ["alice-first", "bob-first"] as const) {
      const alice = new Fugue("A");
      const bob = new Fugue("B");
      const aOps = typeBackward(alice, "abc");
      const bOps = typeBackward(bob, "xyz");
      if (order === "alice-first") exchange(alice, aOps, bob, bOps);
      else exchange(bob, bOps, alice, aOps);
      expect(alice.text()).toBe(bob.text());
      expect(["abcxyz", "xyzabc"]).toContain(alice.text());
    }
  });

  it("keeps P7's pinned RGA case whole: a backward run beside a forward run", () => {
    // The corpus case that splits under RGA (p7-backward-run-interleaves).
    const alice = new Fugue("A");
    const bob = new Fugue("B");
    const aOps = typeBackward(alice, "aa");
    const bOps = typeForward(bob, "bb");
    exchange(alice, aOps, bob, bOps);
    expect(alice.text()).toBe(bob.text());
    expect(["aabb", "bbaa"]).toContain(alice.text());
  });

  it("orders concurrent siblings the same way on every replica", () => {
    const alice = new Fugue("A");
    const bob = new Fugue("B");
    const carol = new Fugue("C");
    const ops = [alice.insert(null, "a"), bob.insert(null, "b"), carol.insert(null, "c")];
    for (const replica of [alice, bob, carol]) for (const op of ops) replica.apply(op);
    // Siblings sort smallest ID first: (1,A), (1,B), (1,C).
    expect(alice.text()).toBe("abc");
    expect(bob.items()).toEqual(alice.items());
    expect(carol.items()).toEqual(alice.items());
  });

  it("ignores an insert delivered twice", () => {
    const alice = new Fugue("A");
    const [a] = typeForward(alice, "a");
    const bob = new Fugue("B");
    if (a === undefined) throw new Error("unreachable");
    bob.apply(a);
    bob.apply(a);
    expect(bob.text()).toBe("a");
  });

  it("walks a long forward chain without overflowing the stack", () => {
    const alice = new Fugue("A");
    typeForward(alice, "x".repeat(50_000));
    expect(alice.text()).toHaveLength(50_000);
  });
});

describe("Fugue delete and held ops", () => {
  it("deletes a character and keeps it as a tombstone", () => {
    const alice = new Fugue("A");
    const [, b] = typeForward(alice, "abc");
    if (b === undefined) throw new Error("unreachable");
    const del = alice.delete(b.id);
    expect(alice.text()).toBe("ac");
    expect(del.id).toEqual({ counter: 4, replica: "A" });
    expect(alice.items().map((item) => item.deleted)).toEqual([false, true, false]);
  });

  it("types after a tombstone the other replica hasn't seen deleted yet", () => {
    // Bob deletes "x" while Alice types "y" after it: "y"'s parent is the tombstone.
    const alice = new Fugue("A");
    const [x] = typeForward(alice, "x");
    if (x === undefined) throw new Error("unreachable");
    const bob = new Fugue("B");
    bob.apply(x);
    const del = bob.delete(x.id);
    const y = alice.insert(x.id, "y");
    alice.apply(del);
    bob.apply(y);
    expect(alice.text()).toBe("y");
    expect(bob.items()).toEqual(alice.items());
  });

  it("ignores a delete delivered twice, and concurrent deletes of the same character", () => {
    const alice = new Fugue("A");
    const [a, b] = typeForward(alice, "ab");
    if (a === undefined || b === undefined) throw new Error("unreachable");
    const bob = new Fugue("B");
    for (const op of [a, b]) bob.apply(op);
    const d1 = alice.delete(a.id);
    const d2 = bob.delete(a.id);
    for (const op of [d2, d2]) alice.apply(op);
    bob.apply(d1);
    expect(alice.text()).toBe("b");
    expect(bob.items()).toEqual(alice.items());
  });

  it("holds an insert back until its parent arrives", () => {
    const alice = new Fugue("A");
    const [h, i] = typeForward(alice, "Hi");
    if (h === undefined || i === undefined) throw new Error("unreachable");
    const bob = new Fugue("B");
    bob.apply(i);
    bob.apply(i);
    expect(bob.pendingCount).toBe(1);
    bob.apply(h);
    expect(bob.text()).toBe("Hi");
    expect(bob.pendingCount).toBe(0);
  });

  it("holds a delete back until its target arrives, then releases a chain", () => {
    const alice = new Fugue("A");
    const ops = typeBackward(alice, "abc");
    const [c] = ops;
    if (c === undefined) throw new Error("unreachable");
    const del = alice.delete(c.id);
    const bob = new Fugue("B");
    for (const op of [del, ...[...ops].reverse()]) bob.apply(op);
    expect(bob.pendingCount).toBe(0);
    expect(bob.text()).toBe("ab");
    expect(bob.items()).toEqual(alice.items());
  });
});
