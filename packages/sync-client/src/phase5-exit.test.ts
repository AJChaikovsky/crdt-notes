import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, expect, it } from "vitest";
import { startServer, type SyncServer } from "@crdt-notes/server";
import { SyncClient } from "./client.js";

// Phase 5 exit (roadmap): three clients, the server killed and restarted mid-session,
// one client offline across the restart, and all three converge to identical state.

let dataDir = "";
let server: SyncServer | null = null;
const clients: SyncClient[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) await client.close();
  await server?.close();
  server = null;
  if (dataDir !== "") rmSync(dataDir, { recursive: true, force: true });
});

/** Deterministic pseudo-random numbers, so a failure always replays the same way. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2 ** 31;
    return state / 2 ** 31;
  };
}

/** `count` random keystrokes at random places: mostly typing, some deleting. */
function edit(client: SyncClient, next: () => number, count: number): void {
  for (let i = 0; i < count; i += 1) {
    const length = client.text().length;
    if (length > 0 && next() < 0.25) client.deleteAt(Math.floor(next() * length));
    else client.insertAt(Math.floor(next() * (length + 1)), "abcxyz"[i % 6] ?? "a");
  }
}

async function eventually(check: () => void): Promise<void> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    try {
      check();
      return;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
}

it("three clients converge across a server restart, with one offline throughout", async () => {
  dataDir = mkdtempSync(join(tmpdir(), "crdt-notes-exit-"));
  server = await startServer({ port: 0, dataDir });
  const port = server.port;
  const devices = [new IDBFactory(), new IDBFactory(), new IDBFactory()];
  const open = async (device: IDBFactory) => {
    const client = await SyncClient.open({
      doc: "notes",
      url: `ws://127.0.0.1:${port}`,
      indexedDB: device,
      reconnectDelayMs: 20,
      snapshotEvery: 50,
    });
    clients.push(client);
    return client;
  };
  const [a, b, c] = await Promise.all(devices.map(open));
  if (a === undefined || b === undefined || c === undefined)
    throw new Error("no clients");
  const next = random(42);

  // Everyone online and editing.
  for (const client of [a, b, c]) client.connect();
  await eventually(() => expect(a.live && b.live && c.live).toBe(true));
  for (let round = 0; round < 5; round += 1)
    for (const client of [a, b, c]) edit(client, next, 10);

  // C goes offline and keeps editing. The server is killed mid-session.
  c.disconnect();
  edit(c, next, 40);
  edit(a, next, 20);
  await server.close();
  edit(a, next, 20); // while the server is down
  edit(b, next, 20);

  // The server restarts from its files. A and B reconnect by themselves; C is still
  // offline and keeps editing.
  server = await startServer({ port, dataDir });
  edit(c, next, 20);
  await eventually(() => expect(a.live && b.live).toBe(true));
  edit(b, next, 20);

  // C comes back.
  c.connect();
  await eventually(() => {
    expect(b.items()).toEqual(a.items());
    expect(c.items()).toEqual(a.items());
  });
  expect(a.text().length).toBeGreaterThan(50);

  // And the converged state survives reloading every device from IndexedDB.
  const texts = [a.text(), b.text(), c.text()];
  for (const client of clients.splice(0)) await client.close();
  const reloaded = await Promise.all(devices.map(open));
  expect(reloaded.map((client) => client.text())).toEqual(texts);
});
