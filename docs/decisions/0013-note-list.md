# ADR-0013 (Architecture Decision Record): the note list and share links

Terms are defined in `../glossary.md`.

- **Status:** ACCEPTED (AJ picked "This device" on 2026-11-23)
- **Date:** 2026-11-23

## Context

The roadmap asks for a document list and share links. There are no accounts (auth is out
of scope), so whoever can see a list of notes can open every note in it. The question was
where a device learns which notes exist.

## Decision

1. **The list is per device.** It holds the notes opened on this device, most recently
   opened first, and works fully offline. A note made on another device appears here once
   its link is opened here.
2. **It lives in its own IndexedDB database,** `crdt-notes-index`, with one store `notes`
   of `{id, title, openedAt}` keyed by `id`. It is a cache for the home screen, not part
   of any note: each note's text stays in its own `crdt-notes:<id>` database (ADR-0010).
   Updates read and write in one transaction, so opening a note and retitling it at the
   same moment can't undo each other.
3. **A note's title is its first non-blank line,** without markdown heading marks and cut
   to 80 characters. It needs no extra synced state: every device works it out from the
   text. The list saves it 500 ms after the last change, and again when leaving the note.
4. **A new note gets a random 16-character ID** from 32 unambiguous letters and digits
   (80 random bits), and its link is the app's address with `#<id>`. With no accounts the
   link is the only key to a note, so it must be unguessable. Opening a link adds the note
   to that device's list.
5. **The address without `#` is the home screen.** Older links with a name, such as
   `#welcome`, still open that note.

## How it is checked

- `apps/web/src/notes.test.ts`: titles, IDs, ordering, reopening, retitling, and two
  updates at once.
- By hand in two Playwright browsers: a new note shows on the home screen under its first
  line, its copied link opens it in a second browser, which then lists it too.

## Rejected

- **Listing notes from the server.** The list would be empty offline, and anyone who can
  reach the server could list and open every note.
- **Both, merged.** The same exposure, and more code.
- **Titles as separate synced state.** Two people renaming at once would need their own
  merge rule, for something the first line already says.

## Consequences

- If a tab is closed less than 500 ms after the first line changed, the list may keep the
  old title. Opening the note again fixes it.
- There is no way to remove a note from the list yet. Removing it would also have to
  delete its database, which loses edits not yet sent.
- Anyone with a link can edit the note, forever. Revoking a link needs accounts.
