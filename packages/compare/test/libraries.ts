import { next as Automerge } from "@automerge/automerge";
import { FastFugue, type FugueOp } from "@crdt-notes/crdt";
import * as Y from "yjs";

/**
 * The smallest common shape over three text CRDTs (Conflict-free Replicated Data Types):
 * a few replicas, local typing by index, and sending everything one replica has to
 * another. Used to run the same interleaving cases through each.
 */
export interface Library {
  readonly name: string;
  /** `count` replicas sharing no state yet. Replica `i` sorts before replica `i + 1`. */
  create(count: number): Replicas;
}

export interface Replicas {
  insertAt(replica: number, index: number, char: string): void;
  text(replica: number): string;
  /** Delivers everything replica `from` has to replica `to`, one way. */
  send(from: number, to: number): void;
}

/** Sends everything everywhere. */
export function syncAll(docs: Replicas, count: number): void {
  for (let from = 0; from < count; from += 1)
    for (let to = 0; to < count; to += 1) if (from !== to) docs.send(from, to);
}

export const fastFugue: Library = {
  name: "FastFugue",
  create(count) {
    const docs = Array.from({ length: count }, (_, i) => new FastFugue(`r${i}`));
    const has = docs.map((): FugueOp[] => []);
    return {
      insertAt: (r, index, char) => {
        const op = docs[r]?.insertAt(index, char);
        if (op !== undefined) has[r]?.push(op);
      },
      text: (r) => docs[r]?.text() ?? "",
      send: (from, to) => {
        for (const op of has[from] ?? []) {
          docs[to]?.apply(op); // ignores an op it already has (P2)
          if (!has[to]?.includes(op)) has[to]?.push(op);
        }
      },
    };
  },
};

export const yjs: Library = {
  name: "Yjs 13.6.33",
  create(count) {
    const docs = Array.from({ length: count }, (_, i) => {
      const doc = new Y.Doc();
      doc.clientID = i + 1; // Yjs breaks ties by client ID; fixed so cases replay
      return doc;
    });
    return {
      insertAt: (r, index, char) => docs[r]?.getText("t").insert(index, char),
      text: (r) => docs[r]?.getText("t").toString() ?? "",
      send: (from, to) => {
        const source = docs[from];
        const target = docs[to];
        if (source === undefined || target === undefined) return;
        Y.applyUpdate(target, Y.encodeStateAsUpdate(source, Y.encodeStateVector(target)));
      },
    };
  },
};

export const automerge: Library = {
  name: "Automerge 3.5.0",
  create(count) {
    // A shared root change, so every replica edits the same text object.
    const root = Automerge.change(Automerge.init<{ t: string }>({ actor: "ff" }), (d) => {
      d.t = "";
    });
    // Actor IDs are hex, and Automerge breaks ties by them; fixed so cases replay.
    const docs = Array.from({ length: count }, (_, i) =>
      Automerge.merge(Automerge.init<{ t: string }>({ actor: `0${i + 1}` }), root),
    );
    return {
      insertAt: (r, index, char) => {
        const doc = docs[r];
        if (doc !== undefined)
          docs[r] = Automerge.change(doc, (d) =>
            Automerge.splice(d, ["t"], index, 0, char),
          );
      },
      text: (r) => docs[r]?.t ?? "",
      send: (from, to) => {
        const source = docs[from];
        const target = docs[to];
        if (source !== undefined && target !== undefined)
          docs[to] = Automerge.merge(target, Automerge.clone(source));
      },
    };
  },
};

export const libraries: readonly Library[] = [fastFugue, yjs, automerge];
