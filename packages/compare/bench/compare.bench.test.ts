import { next as Automerge } from "@automerge/automerge";
import { FastFugue, type FugueOp } from "@crdt-notes/crdt";
import { loadTrace, replayLocal, type Edit } from "@crdt-notes/crdt-testkit/trace";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";

// Phase 7 comparison (roadmap): the same automerge-paper trace (259,778 edits, ending at
// 104,852 characters) through our FastFugue, Yjs and Automerge, measured on one machine
// in one run. EDITS replays a prefix instead.
//
// Each library is driven through its own normal API: Yjs and Automerge take a whole
// edit (delete a range, insert a string) as one change; FastFugue has only per-character
// insertAt and deleteAt, so it makes one op per character. That is how each is meant to
// be used, and the writeup says so next to the numbers.
const all = loadTrace("automerge-paper");
const edits: readonly Edit[] = all.edits.slice(
  0,
  Number(process.env["EDITS"] ?? Infinity),
);
const want = edits.reduce(
  (text, [pos, del, ins]) => text.slice(0, pos) + ins + text.slice(pos + del),
  "",
);

interface Result {
  name: string;
  localMs: number;
  remoteMs: number;
  /** Set when the one-at-a-time replay covered only part of the trace. */
  remoteNote: string;
  batchMs: number;
  savedBytes: number;
  loadMs: number;
  heapMb: number | null;
}
const results: Result[] = [];
const ONE_BY_ONE_LIMIT = Number(process.env["ONE_BY_ONE"] ?? 20_000);

function time<T>(run: () => T): [T, number] {
  const start = performance.now();
  const result = run();
  return [result, performance.now() - start];
}

/**
 * Memory a document built by `make` keeps alive, in MB, or null without `--expose-gc`.
 * JS heap: what is freed when the document is dropped, so garbage left over from earlier
 * steps can't count. External memory: what building it added, because Automerge keeps its
 * document in WebAssembly memory, which grows but is never handed back.
 */
function memory(make: () => unknown): number | null {
  const gc = (globalThis as { gc?: () => void }).gc;
  if (gc === undefined) return null;
  gc();
  const start = process.memoryUsage();
  const alive = [make()];
  gc();
  const built = process.memoryUsage();
  alive.length = 0; // dropped
  gc();
  const dropped = process.memoryUsage();
  return (built.heapUsed - dropped.heapUsed + built.external - start.external) / 1e6;
}

describe(`compare on automerge-paper, ${edits.length} edits`, () => {
  it("FastFugue", () => {
    const author = new FastFugue("A");
    const [ops, localMs] = time(() => replayLocal<FugueOp>(author, edits));
    expect(author.text()).toBe(want);
    const build = () => {
      const doc = new FastFugue("B");
      for (const op of ops) doc.apply(op);
      return doc;
    };
    const peer = build();
    const heapMb = memory(build);
    const [, remoteMs] = time(() => {
      const doc = new FastFugue("C");
      for (const op of ops) doc.apply(op);
    });
    expect(peer.text()).toBe(want);
    // FastFugue has no batch path: a batch is the same loop.
    const batchMs = remoteMs;
    const saved = peer.snapshot();
    const [loaded, loadMs] = time(() => FastFugue.load("B", saved));
    expect(loaded.text()).toBe(want);
    results.push({
      name: "FastFugue (ours)",
      localMs,
      remoteMs,
      remoteNote: "",
      batchMs,
      savedBytes: Buffer.byteLength(saved),
      loadMs,
      heapMb,
    });
  });

  it("Yjs", () => {
    const author = new Y.Doc();
    const text = author.getText("t");
    const updates: Uint8Array[] = [];
    author.on("update", (update: Uint8Array) => updates.push(update));
    const [, localMs] = time(() => {
      for (const [pos, del, ins] of edits) {
        author.transact(() => {
          if (del > 0) text.delete(pos, del);
          if (ins !== "") text.insert(pos, ins);
        });
      }
    });
    expect(text.toString()).toBe(want);
    // The same updates arriving one by one at another replica, as over a network.
    const build = () => {
      const doc = new Y.Doc();
      for (const update of updates) Y.applyUpdate(doc, update);
      return doc;
    };
    const peer = build();
    const heapMb = memory(build);
    const [, remoteMs] = time(() => {
      const doc = new Y.Doc();
      for (const update of updates) Y.applyUpdate(doc, update);
    });
    expect(peer.getText("t").toString()).toBe(want);
    // All at once: every update applied inside one transaction, so observers fire once.
    const [, batchMs] = time(() => {
      const doc = new Y.Doc();
      doc.transact(() => {
        for (const update of updates) Y.applyUpdate(doc, update);
      });
    });
    const saved = Y.encodeStateAsUpdate(peer);
    const [loaded, loadMs] = time(() => {
      const doc = new Y.Doc();
      Y.applyUpdate(doc, saved);
      return doc;
    });
    expect(loaded.getText("t").toString()).toBe(want);
    results.push({
      name: "Yjs 13.6.33",
      localMs,
      remoteMs,
      remoteNote: "",
      batchMs,
      savedBytes: saved.length,
      loadMs,
      heapMb,
    });
  });

  it("Automerge", () => {
    let doc = Automerge.from<{ t: string }>({ t: "" });
    const changes = [...Automerge.getAllChanges(doc)]; // the shared starting change
    const [, localMs] = time(() => {
      for (const [pos, del, ins] of edits) {
        doc = Automerge.change(doc, (d) => Automerge.splice(d, ["t"], pos, del, ins));
        const change = Automerge.getLastLocalChange(doc);
        if (change !== undefined) changes.push(change);
      }
    });
    expect(doc.t).toBe(want);
    // One change at a time gets slower as the document grows (about 3 ms a change by
    // 20,000), so the full trace would take hours: it is timed on a prefix only.
    const prefix = changes.slice(0, ONE_BY_ONE_LIMIT + 1);
    const [, remoteMs] = time(() => {
      let other = Automerge.init<{ t: string }>();
      for (const change of prefix) [other] = Automerge.applyChanges(other, [change]);
    });
    const build = () =>
      Automerge.applyChanges(Automerge.init<{ t: string }>(), changes)[0];
    const peer = build();
    const heapMb = memory(build);
    const [, batchMs] = time(() =>
      Automerge.applyChanges(Automerge.init<{ t: string }>(), changes),
    );
    expect(peer.t).toBe(want);
    const saved = Automerge.save(peer);
    const [loaded, loadMs] = time(() => Automerge.load<{ t: string }>(saved));
    expect(loaded.t).toBe(want);
    results.push({
      name: "Automerge 3.5.0",
      localMs,
      remoteMs,
      remoteNote: prefix.length - 1 < edits.length ? ` (first ${prefix.length - 1})` : "",
      batchMs,
      savedBytes: saved.length,
      loadMs,
      heapMb,
    });
  });

  it("prints the table", () => {
    const mb = (bytes: number) => `${(bytes / 1e6).toFixed(2)} MB`;
    const ms = (n: number) => `${n.toFixed(0)} ms`;
    console.info(
      [
        "| Implementation | Local replay | Remote, one change at a time | Remote, all at once | Saved size | Load | Memory |",
        "|---|---|---|---|---|---|---|",
        ...results.map(
          (r) =>
            `| ${r.name} | ${ms(r.localMs)} | ${ms(r.remoteMs)}${r.remoteNote} | ${ms(r.batchMs)} | ` +
            `${mb(r.savedBytes)} | ` +
            `${ms(r.loadMs)} | ${r.heapMb === null ? "n/a" : `${r.heapMb.toFixed(1)} MB`} |`,
        ),
      ].join("\n"),
    );
  });
});
