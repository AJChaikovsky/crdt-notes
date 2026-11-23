import { appendFileSync, mkdirSync, readFileSync, truncateSync } from "node:fs";
import { join } from "node:path";
import { decodeEntry, encodeEntry, OpLog, type Entry } from "@crdt-notes/sync-protocol";

/**
 * Each document's op log as a file on disk, one entry per line (ADR-0009). Appending a
 * line is the only write, so a crash can at worst cut off the last line, and `load`
 * drops a cut-off line. Clients resend anything the server lacks on their next
 * handshake, so a dropped line is recovered, not lost.
 */
export class DocStore {
  readonly #dir: string;

  constructor(dir: string) {
    this.#dir = dir;
    mkdirSync(dir, { recursive: true });
  }

  /** Reads a document's log, or an empty one if it has never been saved. */
  load(doc: string): OpLog {
    const log = new OpLog();
    let text: string;
    try {
      text = readFileSync(this.#path(doc), "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        return log;
      throw error;
    }
    const complete = text.lastIndexOf("\n") + 1;
    if (complete < text.length) {
      // The last append was cut off mid-line. Remove it, so the next append starts on a
      // fresh line instead of gluing onto the broken one.
      truncateSync(this.#path(doc), Buffer.byteLength(text.slice(0, complete)));
    }
    for (const line of text.slice(0, complete).split("\n")) {
      if (line !== "") log.add(decodeEntry(line));
    }
    return log;
  }

  /** Appends entries to a document's file. */
  append(doc: string, entries: readonly Entry[]): void {
    if (entries.length === 0) return;
    appendFileSync(this.#path(doc), entries.map((e) => encodeEntry(e) + "\n").join(""));
  }

  // Document names come from clients, so they are encoded rather than used as paths:
  // base64url only uses letters, digits, "-" and "_", so "../x" can't escape the folder.
  #path(doc: string): string {
    return join(this.#dir, `${Buffer.from(doc, "utf8").toString("base64url")}.jsonl`);
  }
}
