# ADR-0011 (Architecture Decision Record): the CodeMirror editor binding

Terms are defined in `../glossary.md`.

- **Status:** ACCEPTED (editor chosen by AJ on a decision card, 2026-11-23)
- **Date:** 2026-11-23

## Context

Phase 6 puts the document on screen. The editor must turn each keystroke into CRDT
(Conflict-free Replicated Data Type) edits at exact positions, and show other devices'
edits without moving this person's cursor or wiping their undo history. Rich text is out
of scope, so the document is plain markdown text.

## Decision

1. **CodeMirror 6** (AJ's pick over a plain textarea and over ProseMirror). Its
   transactions describe every edit as exact ranges, and it moves cursors and selections
   through other people's edits by itself.
2. **The CRDT reports text changes.** `FastFugue.subscribe(listener)` reports every
   change to the visible text as `{ kind: "insert", index, char }` or
   `{ kind: "delete", index }`, in the positions of the text just before that change.
   That includes held-back ops applied when their parent arrives, which a "what did
   this one op do" approach would miss. A delete of an already-deleted character
   reports nothing.
   - The index comes from `PositionTree.indexOf(node)`: visible characters before the
     node in its leaf, plus the visible counts of every earlier sibling on the way up.
     About log n steps, so a remote keystroke costs no more than a local one.
   - `SyncClient.onChange(listener)` passes these on with `remote: true` for edits from
     other devices and `false` for this device's own.
3. **Local edits:** after each CodeMirror transaction, `applyToCrdt` applies its changes
   from the last to the first, because all of them are given in positions of the text
   before the transaction. Each change deletes its range, then types its new text one
   UTF-16 code unit at a time, the same unit CodeMirror and JavaScript strings count in.
4. **Remote edits:** each reported change becomes one CodeMirror transaction, annotated
   `fromRemote` so it isn't fed back into the CRDT, and excluded from undo history, so
   Ctrl+Z only takes back this person's own edits.
5. **`apps/web`:** Vite and React 19. The document is named in the address after `#`
   (default `welcome`). The page shows "Synced" or "Offline". The sync server's address
   comes from `VITE_SYNC_URL`, defaulting to `ws://localhost:8787`. `pnpm dev:server`
   and `pnpm dev:web` run both locally.

## How it is checked

- `crdt-testkit/src/text-change.property.test.ts`: on every replica of random
  multi-replica scenarios, a plain string that only ever applies the reported changes
  equals the replica's text after every change. A second property does the same on
  documents big enough to split the B-tree.
- `apps/web/src/binding.test.ts`, with headless CodeMirror states: through random
  transactions of up to three changes each, the CRDT's text stays equal to the editor's,
  and a second editor fed only the reported remote changes stays equal to the first.
- `sync-client` tests check that remote edits arrive flagged `remote` and replay to the
  same text.
- By hand in two Playwright browsers against the real server: typing in one appears in
  the other, edits made while one was offline merge, and a reload restores the text
  from IndexedDB.

Five planted bugs were all caught (`../testing-strategy.md`).

## Rejected

- **Replacing the editor's whole text on every remote edit.** Simple, but it resets the
  cursor and selection and breaks undo.
- **Diffing old and new text to find remote changes.** Costs time proportional to the
  document per edit, and is ambiguous when the same character repeats ("aa" to "aaa":
  which "a" is new?), which can put the cursor on the wrong side.

## Consequences

- The production bundle is about 700 KB before compression, mostly CodeMirror's markdown
  support. Splitting it can wait until load time matters.
- Undo is local and per device, which is what collaborative editors usually do.
