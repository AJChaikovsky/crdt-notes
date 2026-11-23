import { Annotation, type ChangeSet, type ChangeSpec } from "@codemirror/state";
import type { TextChange } from "@crdt-notes/crdt";

/**
 * Marks a CodeMirror transaction that came from another device, so the editor doesn't
 * send it back into the CRDT (ADR-0011).
 */
export const fromRemote = Annotation.define<boolean>();

/** The edit methods the binding needs: `SyncClient` and `FastFugue` both have them. */
export interface Editable {
  insertAt(index: number, char: string): void;
  deleteAt(index: number): void;
}

/**
 * Applies one CodeMirror transaction's changes to the CRDT, one character at a time.
 *
 * A transaction can hold several changes (a multi-cursor edit, a replace-all), all given
 * in positions of the text *before* the transaction. Applying them from the last to the
 * first keeps every earlier position valid. Within one change, the replaced range is
 * deleted first, then the new text is typed in at its start.
 *
 * Positions are UTF-16 code units, as in CodeMirror and JavaScript strings, so each
 * code unit becomes one CRDT character.
 */
export function applyToCrdt(changes: ChangeSet, doc: Editable): void {
  const parts: { from: number; to: number; text: string }[] = [];
  changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    parts.push({ from: fromA, to: toA, text: inserted.toString() });
  });
  for (const { from, to, text } of parts.reverse()) {
    for (let i = from; i < to; i += 1) doc.deleteAt(from);
    for (let i = 0; i < text.length; i += 1) doc.insertAt(from + i, text.charAt(i));
  }
}

/** One CRDT text change as a CodeMirror change, in the editor's current positions. */
export function toCodeMirror(change: TextChange): ChangeSpec {
  return change.kind === "insert"
    ? { from: change.index, insert: change.char }
    : { from: change.index, to: change.index + 1 };
}
