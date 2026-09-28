import { describe, expect, it } from "vitest";
import type { Id } from "./id.js";
import { Rga, type InsertOp, type Op } from "./rga.js";

// The three hand-written exit tests for Phase 1 in docs/roadmap.md.

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

/** Every ordering of `items`, for small arrays. */
function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [
      item,
      ...rest,
    ]),
  );
}

describe("Phase 1 exit", () => {
  it("resolves concurrent inserts at the same position deterministically, in every delivery order", () => {
    const base = new Rga("A");
    const h = base.insert(null, "H");
    const concurrent = ["A", "B", "C"].map((replica, i) => {
      const r = new Rga(replica);
      r.apply(h);
      return r.insert(h.id, "abc"[i] ?? "?");
    });
    const results = new Set(
      permutations(concurrent).map((order) => replay("Z", [h, ...order])),
    );
    // (2,C) > (2,B) > (2,A), so the bigger replica ID sits closest to "H".
    expect([...results]).toEqual(["Hcba"]);
  });

  it("handles delete-then-insert at that position", () => {
    const alice = new Rga("A");
    const ops = type(alice, "Hxz");
    const x = at(ops, 1);
    const del = alice.delete(x.id);
    const y = alice.insert(x.id, "y"); // typed after the deleted "x"
    expect(alice.text()).toBe("Hyz");
    expect(replay("B", [...ops, del, y])).toBe("Hyz");
  });

  it("treats an op delivered twice as a no-op", () => {
    const alice = new Rga("A");
    const ops = type(alice, "ab");
    const del = alice.delete(at(ops, 0).id);
    const all: Op[] = [...ops, del];
    const once = replay("B", all);
    const twice = replay(
      "B",
      all.flatMap((op) => [op, op]),
    );
    const replayedAtEnd = replay("B", [...all, ...all]);
    expect(once).toBe("b");
    expect(twice).toBe(once);
    expect(replayedAtEnd).toBe(once);
  });
});
