import { SyncClient } from "@crdt-notes/sync-client";
import { useEffect, useState } from "react";
import { Editor } from "./Editor.js";
import { NoteIndex, newNoteId, titleOf, type NoteEntry } from "./notes.js";

/** The sync server. Set VITE_SYNC_URL when building; local development uses port 8787. */
const SYNC_URL: string = import.meta.env["VITE_SYNC_URL"] ?? "ws://localhost:8787";

/** The note named in the address after `#`, or `null` on the home screen. */
function useNoteId(): string | null {
  const read = () => decodeURIComponent(location.hash.slice(1)) || null;
  const [id, setId] = useState(read);
  useEffect(() => {
    const onHash = () => setId(read());
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);
  return id;
}

/** The list of notes on this device, opened once for the whole app. */
const notes: Promise<NoteIndex> = NoteIndex.open();

export function App() {
  const id = useNoteId();
  return id === null ? <Home /> : <Note key={id} id={id} />;
}

/** The home screen: every note opened on this device, and a button for a new one. */
function Home() {
  const [list, setList] = useState<NoteEntry[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void notes
      .then((index) => index.list())
      .then((entries) => {
        if (!cancelled) setList(entries);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main>
      <header>
        <h1>Notes</h1>
        <button type="button" onClick={() => (location.hash = newNoteId())}>
          New note
        </button>
      </header>
      {list === null ? null : list.length === 0 ? (
        <p className="muted">
          No notes on this device yet. Start one, or open a link someone shared with you.
        </p>
      ) : (
        <ul className="notes" data-testid="notes">
          {list.map((note) => (
            <li key={note.id}>
              <a href={`#${encodeURIComponent(note.id)}`}>
                {note.title === "" ? <span className="muted">Untitled</span> : note.title}
              </a>
              <time dateTime={new Date(note.openedAt).toISOString()}>
                {new Date(note.openedAt).toLocaleDateString()}
              </time>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

/** One note: its editor, whether it is synced, and a button to copy its link. */
function Note({ id }: { id: string }) {
  const [client, setClient] = useState<SyncClient | null>(null);
  const [live, setLive] = useState(false);
  const [title, setTitle] = useState("");

  useEffect(() => {
    let opened: SyncClient | null = null;
    let cancelled = false;
    let unsubscribe = () => {};
    let retitle: ReturnType<typeof setTimeout> | undefined;
    let saveTitle = () => {};
    let onOffline = () => {};
    let onOnline = () => {};
    void SyncClient.open({ doc: id, url: SYNC_URL }).then(async (c) => {
      const index = await notes;
      if (cancelled) return void c.close();
      opened = c;
      if (import.meta.env.DEV) Object.assign(window, { client: c }); // for poking at it in devtools
      let last = titleOf(c.text());
      setTitle(last);
      void index.opened(id, last);
      saveTitle = () => {
        clearTimeout(retitle);
        const next = titleOf(c.text());
        if (next === last) return;
        last = next;
        setTitle(next);
        void index.retitle(id, next);
      };
      // Keeps the home screen's title current, at most twice a second while typing.
      unsubscribe = c.onChange(() => {
        clearTimeout(retitle);
        retitle = setTimeout(saveTitle, 500);
      });
      // The browser says when the network goes and comes back. Without this a socket on
      // a dead network can look open for minutes, and the dot would say "Synced".
      onOffline = () => c.disconnect();
      onOnline = () => c.connect();
      addEventListener("offline", onOffline);
      addEventListener("online", onOnline);
      if (navigator.onLine) c.connect();
      setClient(c);
    });
    // The client has no status event yet; checking twice a second is plenty for a dot.
    const timer = setInterval(() => setLive(opened?.live ?? false), 500);
    // Closing the tab skips React's cleanup, so save a waiting title then too.
    const onHide = () => saveTitle();
    addEventListener("pagehide", onHide);
    return () => {
      cancelled = true;
      removeEventListener("pagehide", onHide);
      removeEventListener("offline", onOffline);
      removeEventListener("online", onOnline);
      clearInterval(timer);
      saveTitle(); // a title still waiting for its 500 ms is saved now, not dropped
      unsubscribe();
      setClient(null);
      void opened?.close();
    };
  }, [id]);

  useEffect(() => {
    document.title = title === "" ? "CRDT Notes" : `${title} · CRDT Notes`;
  }, [title]);

  return (
    <main>
      <header>
        <a href="#" className="back">
          ← All notes
        </a>
        <span className={live ? "status live" : "status"} data-testid="status">
          {live ? "Synced" : "Offline"}
        </span>
        <CopyLink />
      </header>
      {client === null ? <p>Opening…</p> : <Editor client={client} />}
    </main>
  );
}

/** Copies this note's address. Anyone with it can open and edit the note. */
function CopyLink() {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      type="button"
      onClick={() => void copy()}
      title="Anyone with the link can edit"
    >
      {copied ? "Copied" : "Copy link"}
    </button>
  );
}
