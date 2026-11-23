import { SyncClient } from "@crdt-notes/sync-client";
import { useEffect, useState } from "react";
import { Editor } from "./Editor.js";

/** The sync server. Set VITE_SYNC_URL when building; local development uses port 8787. */
const SYNC_URL: string = import.meta.env["VITE_SYNC_URL"] ?? "ws://localhost:8787";

/** The document named in the address after `#`, like `#shopping`, or "welcome". */
function useDocName(): string {
  const read = () => decodeURIComponent(location.hash.slice(1)) || "welcome";
  const [name, setName] = useState(read);
  useEffect(() => {
    const onHash = () => setName(read());
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);
  return name;
}

export function App() {
  const doc = useDocName();
  const [client, setClient] = useState<SyncClient | null>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    let opened: SyncClient | null = null;
    let cancelled = false;
    void SyncClient.open({ doc, url: SYNC_URL }).then((c) => {
      if (cancelled) return void c.close();
      opened = c;
      if (import.meta.env.DEV) Object.assign(window, { client: c }); // for poking at it in devtools
      c.connect();
      setClient(c);
    });
    // The client has no status event yet; checking twice a second is plenty for a dot.
    const timer = setInterval(() => setLive(opened?.live ?? false), 500);
    return () => {
      cancelled = true;
      clearInterval(timer);
      setClient(null);
      void opened?.close();
    };
  }, [doc]);

  return (
    <main>
      <header>
        <h1>{doc}</h1>
        <span className={live ? "status live" : "status"} data-testid="status">
          {live ? "Synced" : "Offline"}
        </span>
      </header>
      {client === null ? <p>Opening…</p> : <Editor key={doc} client={client} />}
    </main>
  );
}
