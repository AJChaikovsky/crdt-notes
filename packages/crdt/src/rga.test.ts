import { describe, expect, it } from "vitest";
import type { Id } from "./id.js";
import { Rga, type InsertOp } from "./rga.js";

/** Types `text` left to right at the start of an empty replica and returns the ops. */
function type(replica: Rga, text: string): InsertOp[] {
  const ops: InsertOp[] = [];
  let origin: Id | null = null;
  for (const char of text) {
    const op = replica.insert(origin, char);
    ops.push(op);
    origin = op.id;
  }
  return ops;
}

describe("Rga insert", () => {
  it("types left to right", () => {
    const alice = new Rga("A");
    type(alice, "Hello");
    expect(alice.text()).toBe("Hello");
  });

  it("inserts at the start when origin is null", () => {
    const alice = new Rga("A");
    alice.insert(null, "b");
    alice.insert(null, "a");
    expect(alice.text()).toBe("ab");
  });

  it("resolves concurrent inserts at the same spot the same way in both delivery orders", () => {
    const alice = new Rga("A");
    const bob = new Rga("B");
    const h = alice.insert(null, "H");
    bob.apply(h);

    const i = alice.insert(h.id, "i"); // (2,A)
    const o = bob.insert(h.id, "o"); // (2,B)
    alice.apply(o);
    bob.apply(i);

    expect(alice.text()).toBe("Hoi");
    expect(bob.text()).toBe("Hoi");
  });

  it("skips a newer sibling together with everything typed after it", () => {
    // Bob types "yzw" after "H"; Alice concurrently types "x" after "H". Bob's "y" (2,B)
    // beats Alice's "x" (2,A) on the tie-break, and "z", "w" were typed after "y".
    const alice = new Rga("A");
    const bob = new Rga("B");
    const h = alice.insert(null, "H");
    bob.apply(h);
    const bobOps = [bob.insert(h.id, "y")];
    for (const char of "zw") {
      const last = bobOps.at(-1);
      if (last === undefined) throw new Error("unreachable");
      bobOps.push(bob.insert(last.id, char));
    }
    const x = alice.insert(h.id, "x");

    for (const order of [
      [h, x, ...bobOps],
      [h, ...bobOps, x],
    ]) {
      const carol = new Rga("C");
      for (const op of order) carol.apply(op);
      expect(carol.text()).toBe("Hyzwx");
    }
  });

  it("converges whatever order the concurrent ops arrive in", () => {
    const alice = new Rga("A");
    const bob = new Rga("B");
    const aliceOps = type(alice, "Hello");
    const bobOps = type(bob, "World");

    const ab = new Rga("X");
    for (const op of [...aliceOps, ...bobOps]) ab.apply(op);
    const ba = new Rga("Y");
    for (const op of [...bobOps, ...aliceOps]) ba.apply(op);

    expect(ab.text()).toBe(ba.text());
    // Forward runs don't interleave in RGA: each word stays whole.
    expect(["HelloWorld", "WorldHello"]).toContain(ab.text());
  });

  it("gives a local insert a bigger ID than anything already applied", () => {
    const alice = new Rga("A");
    const bob = new Rga("B");
    const ops = type(alice, "abc");
    for (const op of ops) bob.apply(op);
    expect(bob.insert(null, "!").id).toEqual({ counter: 4, replica: "B" });
  });

  it("throws on an insert whose origin hasn't arrived", () => {
    const alice = new Rga("A");
    const [, i] = type(alice, "Hi");
    const bob = new Rga("B");
    if (i === undefined) throw new Error("unreachable");
    expect(() => bob.apply(i)).toThrow(/not been applied/);
  });
});
