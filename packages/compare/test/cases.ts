import { syncAll, type Library } from "./libraries.js";

/** A named concurrent-editing case, run on any library; returns the merged text. */
export interface Case {
  readonly name: string;
  run(lib: Library): string;
}

function typeForward(
  lib: ReturnType<Library["create"]>,
  r: number,
  at: number,
  text: string,
) {
  [...text].forEach((char, k) => lib.insertAt(r, at + k, char));
}
function typeBackward(
  lib: ReturnType<Library["create"]>,
  r: number,
  at: number,
  text: string,
) {
  [...text].reverse().forEach((char) => lib.insertAt(r, at, char));
}

/** Merges, checks every replica agrees, and returns the text. */
function merged(docs: ReturnType<Library["create"]>, count: number): string {
  syncAll(docs, count);
  const text = docs.text(0);
  for (let r = 1; r < count; r += 1)
    if (docs.text(r) !== text) throw new Error(`replica ${r} diverged: ${docs.text(r)}`);
  return text;
}

export const cases: readonly Case[] = [
  {
    // design doc section 3: two people typing left to right at the same place.
    name: "forward runs: Hello and World typed at the same place",
    run(lib) {
      const docs = lib.create(2);
      typeForward(docs, 0, 0, "Hello");
      typeForward(docs, 1, 0, "World");
      return merged(docs, 2);
    },
  },
  {
    // design doc section 3: each run typed by inserting every character at index 0.
    name: "backward runs: abc and xyz each typed at index 0",
    run(lib) {
      const docs = lib.create(2);
      typeBackward(docs, 0, 0, "abc");
      typeBackward(docs, 1, 0, "xyz");
      return merged(docs, 2);
    },
  },
  {
    // The Art of the Fugue, Appendix A.1.9, "Yjs backward interleaving (multi-replica)":
    // replica 3 types b; replica 1 receives it and types a before it; replica 2, having
    // seen nothing, types x. The paper reports Yjs 13.6.8 merging to "axb".
    name: "multi-replica backward: a typed before b on another replica's b, x concurrent",
    run(lib) {
      const docs = lib.create(3);
      docs.insertAt(2, 0, "b");
      docs.send(2, 0);
      docs.insertAt(0, 0, "a");
      docs.insertAt(1, 0, "x");
      return merged(docs, 3);
    },
  },
];
