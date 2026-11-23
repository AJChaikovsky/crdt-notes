# ADR-0012 (Architecture Decision Record): presence, other people's cursors

Terms are defined in `../glossary.md`.

- **Status:** ACCEPTED (follows from the roadmap; no new fork)
- **Date:** 2026-11-23

## Context

The roadmap asks for cursor and selection presence as "an ephemeral layer, not in the
CRDT (Conflict-free Replicated Data Type)": where other people are in the document right
now, which matters only while they are connected and must never be saved or merged.

## Decision

1. **Positions are anchors, not indices.** `FastFugue.anchorAt(index)` gives the ID of
   the character just before the position, or `null` for the start.
   `indexOfAnchor(anchor)` turns it back into an index on any replica: just after that
   character, or where it was if it has been deleted, or `null` if this replica hasn't
   received it yet. An index would point at the wrong place the moment anyone typed
   before it; an anchor keeps meaning "after this character".
2. **A selection is two anchors:** `anchor` where it started and `head` where the cursor
   is.
3. **A new `presence` message** `{replica, selection}` goes from client to server and is
   relayed to the document's other clients. `selection: null` means that person has left.
   - The server never writes presence to disk. It keeps only each connected client's
     latest presence in memory, sends those to a client that joins, and announces
     `null` for a client whose connection closes.
   - The client sends its selection at most every 50 ms, again after each handshake, and
     forgets everyone else's when its own connection drops, since they would go stale.
4. **In the editor,** other people's cursors are CodeMirror decorations: a coloured bar
   with a "Guest" label and a tinted selection, never part of the text. They are
   rebuilt from `peers()` whenever presence changes, and moved along with local edits in
   between. Each replica gets a steady colour from a hash of its ID. Names wait for
   accounts, which are out of scope.

## How it is checked

- `crdt/src/fugue.test.ts`: anchors survive inserts before them and the deletion of
  their character, and round-trip every index of a document big enough to split the
  B-tree.
- `sync-protocol`: presence messages round-trip and are fuzzed with the rest.
- `server.test.ts`: presence is relayed, shown to newcomers, announced on leaving, and
  forgotten across a restart.
- `client.test.ts`: another device's selection shows at the right indices and moves when
  someone types before it; it disappears when that device disconnects.
- By hand in two Playwright browsers: the cursor and selection show, and stay on the same
  word while the other person types above it.

Four planted bugs were all caught (`../testing-strategy.md`).

## Rejected

- **Presence as CRDT ops.** It would be saved forever and replayed to every new device,
  for information that is stale within seconds.
- **Sending indices.** Wrong as soon as two people type at once.

## Consequences

- A server from before this change closes the connection on a `presence` message, and the
  client then reconnects in a loop. Deploy the server before the web app.
- A cursor next to a character this device hasn't received yet stays hidden until that
  character arrives.
