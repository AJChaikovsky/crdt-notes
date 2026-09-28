import { describe, expect, it } from "vitest";
import type { Id } from "./id.js";
import { Rga, type InsertOp, type Op } from "./rga.js";

/** Types `text` left to right after `origin` and returns the ops. */
function type(replica: Rga, text: string, origin: Id | null = null): InsertOp[] {
  const ops: InsertOp[] = [];
  let after = origin;
  for (const char of text) {
    const op = replica.insert(after, char);
    ops.push(op);
    after = op.id;
  }
  return ops;
}

function replay(replica: string, ops: readonly Op[]): string {
  const r = new Rga(replica);
  for (const op of ops) r.apply(op);
  return r.text();
}

function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`no item at ${index}`);
  return item;
}

describe("Rga delete", () => {
  it("hides the deleted character", () => {
    const alice = new Rga("A");
    const ops = type(alice, "Hxz");
    alice.delete(at(ops, 1).id);
    expect(alice.text()).toBe("Hz");
  });

  it("gets its own ID from the clock", () => {
    const alice = new Rga("A");
    const ops = type(alice, "ab");
    expect(alice.delete(at(ops, 0).id).id).toEqual({ counter: 3, replica: "A" });
  });

  it("moves the receiver's clock past the delete's ID", () => {
    // Keeps the Lamport rule for every op: anything Bob creates after seeing the delete
    // gets a bigger counter, which the sync layer will rely on.
    const alice = new Rga("A");
    const [a] = type(alice, "a");
    if (a === undefined) throw new Error("unreachable");
    const bob = new Rga("B");
    bob.apply(a);
    bob.apply(alice.delete(a.id)); // (2,A)
    expect(bob.insert(null, "b").id).toEqual({ counter: 3, replica: "B" });
  });

  it("keeps a tombstone usable as an origin, in both delivery orders", () => {
    // Bob types "y" after "x" while Alice deletes "x".
    const alice = new Rga("A");
    const base = type(alice, "Hxz");
    const bob = new Rga("B");
    for (const op of base) bob.apply(op);

    const del = alice.delete(at(base, 1).id);
    const y = bob.insert(at(base, 1).id, "y");
    alice.apply(y);
    bob.apply(del);

    expect(alice.text()).toBe("Hyz");
    expect(bob.text()).toBe("Hyz");
    expect(replay("C", [...base, y, del])).toBe("Hyz");
  });

  it("still skips a deleted newer sibling", () => {
    // Bob types "y" after "H" and deletes it; Alice concurrently types "x" after "H".
    // The tombstone keeps its place, so later inserts after it still land consistently.
    const alice = new Rga("A");
    const h = alice.insert(null, "H");
    const bob = new Rga("B");
    bob.apply(h);
    const y = bob.insert(h.id, "y"); // (2,B)
    const z = bob.insert(y.id, "z"); // (3,B), typed after the soon-deleted "y"
    const del = bob.delete(y.id);
    const x = alice.insert(h.id, "x"); // (2,A)

    const orders: Op[][] = [
      [h, x, y, z, del],
      [h, y, z, del, x],
      [h, y, x, z, del],
    ];
    for (const order of orders) expect(replay("C", order)).toBe("Hzx");
  });

  it("is harmless when delivered twice", () => {
    const alice = new Rga("A");
    const ops = type(alice, "abc");
    const del = alice.delete(at(ops, 1).id);
    const bob = new Rga("B");
    for (const op of [...ops, del, del]) bob.apply(op);
    expect(bob.text()).toBe("ac");
  });

  it("converges when two replicas delete the same character concurrently", () => {
    const alice = new Rga("A");
    const ops = type(alice, "abc");
    const bob = new Rga("B");
    for (const op of ops) bob.apply(op);
    const delA = alice.delete(at(ops, 1).id);
    const delB = bob.delete(at(ops, 1).id);
    alice.apply(delB);
    bob.apply(delA);
    expect(alice.text()).toBe("ac");
    expect(bob.text()).toBe("ac");
  });

  it("holds a delete back until its target arrives", () => {
    const alice = new Rga("A");
    const [a] = type(alice, "a");
    if (a === undefined) throw new Error("unreachable");
    const del = alice.delete(a.id);
    const bob = new Rga("B");
    bob.apply(del);
    expect(bob.pendingCount).toBe(1);
    bob.apply(a);
    expect(bob.text()).toBe("");
    expect(bob.items()).toEqual(alice.items());
    expect(bob.pendingCount).toBe(0);
  });
});

describe("Rga visibleIds", () => {
  it("lists visible IDs in document order, skipping tombstones", () => {
    const alice = new Rga("A");
    const ops = type(alice, "abc");
    alice.delete(at(ops, 1).id);
    expect(alice.visibleIds()).toEqual([at(ops, 0).id, at(ops, 2).id]);
  });

  it("items() lists tombstones too, in the same place on every replica", () => {
    const alice = new Rga("A");
    const x = alice.insert(null, "x");
    const bob = new Rga("B");
    bob.apply(x);
    const del = bob.delete(x.id);
    const y = alice.insert(x.id, "y"); // typed after "x" before Alice saw the delete
    alice.apply(del);
    bob.apply(y);
    expect(alice.items()).toEqual([
      { id: x.id, char: "x", deleted: true },
      { id: y.id, char: "y", deleted: false },
    ]);
    expect(bob.items()).toEqual(alice.items());
  });

  it("items() returns copies", () => {
    const alice = new Rga("A");
    const x = alice.insert(null, "x");
    const [item] = alice.items();
    if (item === undefined) throw new Error("expected one item");
    (item as { deleted: boolean }).deleted = true;
    expect(alice.text()).toBe("x");
    expect(x.char).toBe("x");
  });
});
