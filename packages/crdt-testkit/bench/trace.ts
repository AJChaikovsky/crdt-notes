import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

/** One edit: at visible `pos`, delete `del` characters, then insert `ins`. */
export type Edit = readonly [pos: number, del: number, ins: string];

export interface Trace {
  readonly edits: readonly Edit[];
  readonly endContent: string;
}

interface TraceFile {
  readonly endContent: string;
  readonly txns: readonly { readonly patches: readonly Edit[] }[];
}

/** Loads a sequential trace in the editing-traces format (see traces/README.md). */
export function loadTrace(name: string): Trace {
  const url = new URL(`./traces/${name}.json.gz`, import.meta.url);
  const file = JSON.parse(gunzipSync(readFileSync(url)).toString("utf8")) as TraceFile;
  return { edits: file.txns.flatMap((t) => t.patches), endContent: file.endContent };
}

/** The text after applying `edits` to a plain string: the oracle a replay must match. */
export function expectedText(edits: readonly Edit[]): string {
  let text = "";
  for (const [pos, del, ins] of edits)
    text = text.slice(0, pos) + ins + text.slice(pos + del);
  return text;
}

/** What a replica must support for a local replay: edits addressed by visible index. */
export interface IndexEditable<O> {
  insertAt(index: number, char: string): O;
  deleteAt(index: number): O;
}

/** Replays `edits` as local typing on one replica and returns every op it produced. */
export function replayLocal<O>(doc: IndexEditable<O>, edits: readonly Edit[]): O[] {
  const ops: O[] = [];
  for (const [pos, del, ins] of edits) {
    for (let k = 0; k < del; k += 1) ops.push(doc.deleteAt(pos));
    let at = pos;
    for (const char of ins) ops.push(doc.insertAt(at++, char));
  }
  return ops;
}
