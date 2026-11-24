import { describe, expect, it } from "vitest";
import { cases } from "./cases.js";
import { automerge, fastFugue, yjs, type Library } from "./libraries.js";

// What each library merges the design doc's interleaving cases to (docs/crdt-design.md,
// sections 3 and 7). These pin observed behaviour of pinned library versions: if an
// upgrade changes an answer, this fails and the writeup needs updating.
//
// "Fine" means each person's typing stays together; which person's comes first is a
// tie-break and doesn't matter. "Interleaved" means it doesn't.
const observed: Record<string, Record<string, string>> = {
  "forward runs: Hello and World typed at the same place": {
    [fastFugue.name]: "HelloWorld", // fine
    [yjs.name]: "HelloWorld", // fine
    [automerge.name]: "WorldHello", // fine
  },
  "backward runs: abc and xyz each typed at index 0": {
    [fastFugue.name]: "abcxyz", // fine
    [yjs.name]: "abcxyz", // fine
    [automerge.name]: "xaybzc", // interleaved, as RGA does (ADR-0001)
  },
  "multi-replica backward: a typed before b on another replica's b, x concurrent": {
    [fastFugue.name]: "xab", // fine: a stays next to the b it was typed before
    [yjs.name]: "axb", // interleaved: reproduces The Art of the Fugue, Appendix A.1.9
    [automerge.name]: "abx", // fine
  },
};

describe.each<Library>([fastFugue, yjs, automerge])("$name", (lib) => {
  for (const c of cases)
    it(c.name, () => {
      expect(c.run(lib)).toBe(observed[c.name]?.[lib.name]);
    });
});
