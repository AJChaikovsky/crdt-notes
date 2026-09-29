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

  it("throws on an insert whose parent hasn't arrived (buffering comes next)", () => {
    const alice = new Fugue("A");
    const [, i] = typeForward(alice, "Hi");
    if (i === undefined) throw new Error("unreachable");
    expect(() => new Fugue("B").apply(i)).toThrow(/not been applied/);
  });
});
