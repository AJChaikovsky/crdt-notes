import { StateEffect, type Extension } from "@codemirror/state";
import {
  Decoration,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type EditorView,
  type ViewUpdate,
} from "@codemirror/view";

/** What the presence layer needs from `SyncClient`. */
export interface PeerSource {
  peers(): { replica: string; anchor: number; head: number }[];
  onPresence(listener: () => void): () => void;
}

/** Dispatched when someone's cursor moves, so the decorations are rebuilt. */
const refresh = StateEffect.define<null>();

/** A steady colour per replica, so each person keeps theirs across reloads. */
export function colorFor(replica: string): string {
  let hash = 0;
  for (let i = 0; i < replica.length; i += 1)
    hash = (hash * 31 + replica.charCodeAt(i)) | 0;
  return `hsl(${Math.abs(hash) % 360} 70% 45%)`;
}

class Caret extends WidgetType {
  constructor(
    readonly color: string,
    readonly label: string,
  ) {
    super();
  }

  override eq(other: Caret): boolean {
    return other.color === this.color && other.label === this.label;
  }

  toDOM(): HTMLElement {
    const caret = document.createElement("span");
    caret.className = "peer-caret";
    caret.style.borderColor = this.color;
    caret.style.setProperty("--peer", this.color);
    caret.dataset["label"] = this.label;
    caret.setAttribute("aria-hidden", "true");
    return caret;
  }
}

function build(view: EditorView, source: PeerSource): DecorationSet {
  const length = view.state.doc.length;
  const ranges = [];
  for (const peer of source.peers()) {
    const color = colorFor(peer.replica);
    const anchor = Math.min(peer.anchor, length);
    const head = Math.min(peer.head, length);
    const from = Math.min(anchor, head);
    const to = Math.max(anchor, head);
    if (from < to)
      ranges.push(
        Decoration.mark({
          class: "peer-selection",
          attributes: { style: `--peer: ${color}` },
        }).range(from, to),
      );
    ranges.push(
      Decoration.widget({
        widget: new Caret(color, `Guest ${peer.replica.slice(0, 4)}`),
        side: 1,
      }).range(head),
    );
  }
  return Decoration.set(ranges, true);
}

/**
 * Shows other people's cursors and selections (ADR-0012). They live outside the CRDT and
 * outside the document: just decorations, rebuilt from `peers()` whenever someone's
 * cursor moves, and moved along with the text when it changes in between.
 */
export function presence(source: PeerSource): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      readonly #unsubscribe: () => void;

      constructor(view: EditorView) {
        this.decorations = build(view, source);
        // Rebuilt outside the current update: dispatching inside one isn't allowed.
        this.#unsubscribe = source.onPresence(() =>
          queueMicrotask(() => view.dispatch({ effects: refresh.of(null) })),
        );
      }

      update(update: ViewUpdate): void {
        const refreshed = update.transactions.some((tr) =>
          tr.effects.some((effect) => effect.is(refresh)),
        );
        // A local edit reaches the CRDT only after this runs, so between rebuilds the
        // decorations are moved through the edit instead of read from the CRDT.
        this.decorations = refreshed
          ? build(update.view, source)
          : this.decorations.map(update.changes);
      }

      destroy(): void {
        this.#unsubscribe();
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}
