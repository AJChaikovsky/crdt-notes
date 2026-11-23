import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { NoteIndex, newNoteId, titleOf } from "./notes.js";

describe("titleOf", () => {
  it("takes the first non-blank line, without heading marks", () => {
    expect(titleOf("\n\n# Shopping list\n- bread")).toBe("Shopping list");
    expect(titleOf("  plain first line  \nsecond")).toBe("plain first line");
    expect(titleOf("#hashtag is not a heading")).toBe("#hashtag is not a heading");
  });

  it("is empty for an empty note, and cuts long lines", () => {
    expect(titleOf("")).toBe("");
    expect(titleOf("   \n\t\n")).toBe("");
    const title = titleOf("x".repeat(200));
    expect(title).toHaveLength(80);
    expect(title.endsWith("…")).toBe(true);
  });
});

describe("newNoteId", () => {
  it("is 16 unambiguous characters, different every time", () => {
    const ids = new Set(Array.from({ length: 1000 }, newNoteId));
    expect(ids.size).toBe(1000);
    for (const id of ids) expect(id).toMatch(/^[a-km-z2-9]{16}$/);
  });
});

describe("NoteIndex", () => {
  it("lists notes most recently opened first, and survives reopening", async () => {
    const device = new IDBFactory();
    const index = await NoteIndex.open(device);
    await index.opened("a", "Alpha", 1);
    await index.opened("b", "Beta", 2);
    await index.opened("a", undefined, 3); // reopened: keeps its title
    index.close();
    const again = await NoteIndex.open(device);
    expect(await again.list()).toEqual([
      { id: "a", title: "Alpha", openedAt: 3 },
      { id: "b", title: "Beta", openedAt: 2 },
    ]);
    again.close();
  });

  it("retitles without changing the order", async () => {
    const index = await NoteIndex.open(new IDBFactory());
    await index.opened("a", "", 1);
    await index.opened("b", "", 2);
    await index.retitle("a", "Now has a title");
    expect(await index.list()).toEqual([
      { id: "b", title: "", openedAt: 2 },
      { id: "a", title: "Now has a title", openedAt: 1 },
    ]);
    index.close();
  });

  it("keeps both of two updates sent at once", async () => {
    const index = await NoteIndex.open(new IDBFactory());
    await Promise.all([index.opened("a", undefined, 5), index.retitle("a", "Title")]);
    expect(await index.list()).toEqual([{ id: "a", title: "Title", openedAt: 5 }]);
    index.close();
  });
});
