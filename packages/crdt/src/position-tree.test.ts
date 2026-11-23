import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { PositionTree, type FugueNode } from "./position-tree.js";

type Step =
  | { readonly kind: "after" | "before"; readonly pick: number }
  | { readonly kind: "delete"; readonly pick: number };

const step: fc.Arbitrary<Step> = fc.record({
  kind: fc.constantFrom("after" as const, "before" as const, "delete" as const),
  pick: fc.nat(),
});

/** Runs `steps` against the tree and against a plain array, which is the oracle. */
function check(steps: readonly Step[], max: number): void {
  const tree = new PositionTree(max);
  const model: FugueNode[] = [];
  let counter = 0;
  for (const s of steps) {
    // pick === model.length means "no anchor": the start for after, the end for before.
    const pick = s.pick % (model.length + 1);
    const anchor = model[pick] ?? null;
    if (s.kind === "delete") {
      if (anchor !== null) {
        tree.setDeleted(anchor);
        // Marking is in place, so the model already sees it.
      }
      continue;
    }
    const node: FugueNode = {
      id: { counter: (counter += 1), replica: "A" },
      char: "x",
      parent: null,
      side: "right",
      deleted: false,
      left: [],
      right: [],
      leaf: tree.placeholder,
    };
    if (s.kind === "after") {
      tree.insertAfter(anchor, node);
      model.splice(anchor === null ? 0 : pick + 1, 0, node);
    } else {
      tree.insertBefore(anchor, node);
      model.splice(anchor === null ? model.length : pick, 0, node);
    }
  }
  expect([...tree]).toEqual(model);
  const visible = model.filter((node) => !node.deleted);
  expect(tree.visible).toBe(visible.length);
  visible.forEach((node, i) => expect(tree.atVisible(i)).toBe(node));
  model.forEach((node, i) => expect(tree.next(node)).toBe(model[i + 1]));
  expect(tree.first()).toBe(model[0]);
}

describe("PositionTree", () => {
  it("keeps the same order and counts as a plain array, across many splits", () => {
    // max 3 makes leaves and inner nodes split constantly, so a few hundred steps build a
    // tree several levels deep.
    fc.assert(
      fc.property(fc.array(step, { maxLength: 400 }), (steps) => check(steps, 3)),
    );
  });

  it("works at the default split size", () => {
    fc.assert(
      fc.property(fc.array(step, { minLength: 500, maxLength: 2000 }), (steps) =>
        check(steps, 64),
      ),
      { numRuns: 20 },
    );
  });

  it("rejects an index with no visible character", () => {
    const tree = new PositionTree();
    expect(() => tree.atVisible(0)).toThrow(RangeError);
  });
});
