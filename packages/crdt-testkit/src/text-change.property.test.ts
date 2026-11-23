import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { FastFugue, type FugueOp, type TextChange } from "@crdt-notes/crdt";
import type { Implementation } from "./implementation.js";
import { propertyParameters } from "./property.js";
import { run, scenario } from "./scenario.js";

/** What an editor does with one change: the plain-string version of it. */
function applyChange(text: string, change: TextChange): string {
  expect(change.index).toBeGreaterThanOrEqual(0);
  if (change.kind === "insert") {
    expect(change.index).toBeLessThanOrEqual(text.length);
    return text.slice(0, change.index) + change.char + text.slice(change.index);
  }
  expect(change.index).toBeLessThan(text.length);
  return text.slice(0, change.index) + text.slice(change.index + 1);
}

// ADR-0011: an editor that only ever applies the reported changes, starting from an
// empty document, must always show exactly the replica's text.
describe("FastFugue text changes", () => {
  it("replay to the replica's text, after every op, on every replica", () => {
    fc.assert(
      fc.property(scenario(), fc.boolean(), (s, causal) => {
        const mirrors: { doc: FastFugue; text: string }[] = [];
        const watched: Implementation<FugueOp> = {
          name: "FastFugue, watched",
          create: (id) => {
            const doc = new FastFugue(id);
            const mirror = { doc, text: "" };
            mirrors.push(mirror);
            doc.subscribe((change) => {
              mirror.text = applyChange(mirror.text, change);
              expect(mirror.text).toBe(doc.text());
            });
            return doc;
          },
        };
        run(watched, s, { causal });
        for (const { doc, text } of mirrors) expect(text).toBe(doc.text());
      }),
      propertyParameters(),
    );
  });

  it("report the right index in documents big enough to split the B-tree", () => {
    const edit = fc.record({ del: fc.boolean(), pick: fc.nat() });
    fc.assert(
      fc.property(fc.array(edit, { minLength: 200, maxLength: 800 }), (edits) => {
        const author = new FastFugue("A");
        const peer = new FastFugue("B");
        let mirror = "";
        peer.subscribe((change) => (mirror = applyChange(mirror, change)));
        for (const { del, pick } of edits) {
          const length = author.text().length;
          const op =
            del && length > 0
              ? author.deleteAt(pick % length)
              : author.insertAt(pick % (length + 1), "abc"[pick % 3] ?? "a");
          peer.apply(op);
        }
        expect(mirror).toBe(author.text());
      }),
      { ...propertyParameters(), numRuns: 50 },
    );
  });
});
