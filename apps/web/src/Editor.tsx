import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorState, Transaction } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import type { SyncClient } from "@crdt-notes/sync-client";
import { useEffect, useRef } from "react";
import { applyToCrdt, fromRemote, toCodeMirror } from "./binding.js";
import { presence } from "./presence.js";

/**
 * A CodeMirror markdown editor bound to one document (ADR-0011). Local edits go into the
 * CRDT; remote edits come back out of it as single-character changes, so the cursor and
 * selection stay where they are instead of the whole text being replaced.
 */
export function Editor({ client }: { client: SyncClient }) {
  const parent = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (parent.current === null) return;
    const view = new EditorView({
      parent: parent.current,
      state: EditorState.create({
        doc: client.text(),
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          markdown(),
          syntaxHighlighting(defaultHighlightStyle),
          EditorView.lineWrapping,
          presence(client),
          EditorView.updateListener.of((update) => {
            let local = false;
            for (const tr of update.transactions)
              if (tr.docChanged && tr.annotation(fromRemote) !== true) {
                applyToCrdt(tr.changes, client);
                local = true;
              }
            // After the CRDT has the edit, so the anchors name the right characters.
            if (local || update.selectionSet) {
              const { anchor, head } = update.state.selection.main;
              client.setSelection(anchor, head);
            }
          }),
        ],
      }),
    });
    const unsubscribe = client.onChange((change, remote) => {
      if (!remote) return;
      view.dispatch({
        changes: toCodeMirror(change),
        // Not undoable here: undo only takes back this person's own edits.
        annotations: [fromRemote.of(true), Transaction.addToHistory.of(false)],
      });
    });
    return () => {
      unsubscribe();
      view.destroy();
    };
  }, [client]);

  return <div className="editor" ref={parent} data-testid="editor" />;
}
