import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startServer, type SyncServer } from "@crdt-notes/server";
import { SyncClient, type ClientOptions } from "./client.js";
import { Storage } from "./storage.js";

let dataDir: string;
let server: SyncServer | null = null;
const clients: SyncClient[] = [];

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "crdt-notes-client-"));
});

afterEach(async () => {
  for (const client of clients.splice(0)) await client.close();
  await server?.close();
  server = null;
  rmSync(dataDir, { recursive: true, force: true });
});

/** Each device has its own IndexedDB, like separate browsers. */
async function open(
  device: IDBFactory,
  options: Partial<ClientOptions> = {},
): Promise<SyncClient> {
  const client = await SyncClient.open({
    doc: "notes",
    url: `ws://127.0.0.1:${server?.port ?? 1}`,
    indexedDB: device,
    reconnectDelayMs: 20,
    ...options,
  });
  clients.push(client);
  return client;
}

async function reopen(client: SyncClient, device: IDBFactory, options = {}) {
  clients.splice(clients.indexOf(client), 1);
  await client.close();
  return open(device, options);
}

function type(client: SyncClient, index: number, text: string): void {
  [...text].forEach((char, i) => client.insertAt(index + i, char));
}

/** Waits until `check` passes, up to 5 s. */
async function eventually(check: () => void): Promise<void> {
  const deadline = Date.now() + 5000;
  for (;;) {
    try {
      check();
      return;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}

describe("SyncClient storage", () => {
  it("reopens with the same text and replica ID", async () => {
    const device = new IDBFactory();
    const first = await open(device);
    type(first, 0, "hello");
    first.deleteAt(0);
    const again = await reopen(first, device);
    expect(again.text()).toBe("ello");
    expect(again.replica).toBe(first.replica);
    type(again, 4, "!");
    expect(again.text()).toBe("ello!");
  });

  it("loads from a snapshot plus the entries saved after it", async () => {
    const device = new IDBFactory();
    const first = await open(device, { snapshotEvery: 4 });
    type(first, 0, "abcdefghij"); // snapshots after 4 and 8 entries, maybe batched
    await first.saved();
    const saved = await peek(device);
    expect(saved.snapshot).not.toBeNull();
    expect(saved.entries).toHaveLength(10);

    const again = await reopen(first, device, { snapshotEvery: 4 });
    expect(again.text()).toBe("abcdefghij");
    expect(again.items()).toEqual(first.items());
  });

  it("gives a device with nothing saved a new replica ID", async () => {
    const a = await open(new IDBFactory());
    const b = await open(new IDBFactory());
    expect(a.replica).not.toBe(b.replica);
  });
});

describe("SyncClient sync", () => {
  it("relays edits between two devices while both are online", async () => {
    server = await startServer({ port: 0, dataDir });
    const alice = await open(new IDBFactory());
    const bob = await open(new IDBFactory());
    alice.connect();
    bob.connect();
    await eventually(() => expect(alice.live && bob.live).toBe(true));
    type(alice, 0, "hi");
    await eventually(() => expect(bob.text()).toBe("hi"));
    type(bob, 2, "!");
    await eventually(() => expect(alice.text()).toBe("hi!"));
  });

  it("reports remote edits as changes an editor can replay", async () => {
    server = await startServer({ port: 0, dataDir });
    const alice = await open(new IDBFactory());
    const bob = await open(new IDBFactory());
    let mirror = "";
    const remote: boolean[] = [];
    bob.onChange((change, isRemote) => {
      remote.push(isRemote);
      mirror =
        change.kind === "insert"
          ? mirror.slice(0, change.index) + change.char + mirror.slice(change.index)
          : mirror.slice(0, change.index) + mirror.slice(change.index + 1);
    });
    type(bob, 0, "bb");
    alice.connect();
    bob.connect();
    type(alice, 0, "aaa");
    alice.deleteAt(1);
    await eventually(() => expect(bob.text()).toBe(alice.text()));
    expect(mirror).toBe(bob.text());
    expect(remote.slice(0, 2)).toEqual([false, false]);
    expect(remote.slice(2).every(Boolean)).toBe(true);
  });

  it("merges edits made offline on both sides when they reconnect", async () => {
    server = await startServer({ port: 0, dataDir });
    const alice = await open(new IDBFactory());
    const bob = await open(new IDBFactory());
    type(alice, 0, "alice");
    type(bob, 0, "bob");
    alice.connect();
    bob.connect();
    await eventually(() => {
      expect(alice.text()).toHaveLength(8);
      expect(bob.items()).toEqual(alice.items());
    });
  });

  it("reconnects by itself after the server restarts", async () => {
    server = await startServer({ port: 0, dataDir });
    const port = server.port;
    const alice = await open(new IDBFactory());
    const bob = await open(new IDBFactory());
    alice.connect();
    bob.connect();
    type(alice, 0, "before");
    await eventually(() => expect(bob.text()).toBe("before"));

    await server.close();
    type(alice, 6, " during");
    server = await startServer({ port, dataDir });
    await eventually(() => expect(bob.text()).toBe("before during"));
  });

  it("keeps what it received across a reload, and sends nothing twice", async () => {
    server = await startServer({ port: 0, dataDir });
    const device = new IDBFactory();
    const alice = await open(device);
    const bob = await open(new IDBFactory());
    alice.connect();
    bob.connect();
    type(bob, 0, "from bob");
    await eventually(() => expect(alice.text()).toBe("from bob"));
    const reloaded = await reopen(alice, device);
    expect(reloaded.text()).toBe("from bob"); // offline, from IndexedDB alone
  });
});

describe("SyncClient safety", () => {
  it("never sends an edit before it is saved, and retries a failed save", async () => {
    server = await startServer({ port: 0, dataDir });
    const alice = await open(new IDBFactory());
    const bob = await open(new IDBFactory());
    alice.connect();
    bob.connect();
    await eventually(() => expect(alice.live && bob.live).toBe(true));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const write = vi
      .spyOn(Storage.prototype, "write")
      .mockRejectedValue(new Error("disk full"));
    type(alice, 0, "x");
    await expect(alice.saved()).rejects.toThrow("disk full");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(bob.text()).toBe(""); // not saved, so never sent

    write.mockRestore(); // the disk recovers: the next write saves both, then sends
    type(alice, 1, "y");
    await eventually(() => expect(bob.text()).toBe("xy"));
    quiet.mockRestore();
  });

  it("leaves unsaved edits out of the handshake on connect", async () => {
    server = await startServer({ port: 0, dataDir });
    const alice = await open(new IDBFactory());
    const bob = await open(new IDBFactory());
    bob.connect();
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const write = vi
      .spyOn(Storage.prototype, "write")
      .mockRejectedValue(new Error("disk full"));
    type(alice, 0, "x"); // offline, and the save fails
    alice.connect();
    await eventually(() => expect(alice.live).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(bob.text()).toBe("");
    write.mockRestore();
    quiet.mockRestore();
    await alice.saved(); // the retry succeeds and sends it
    await eventually(() => expect(bob.text()).toBe("x"));
  });
});

async function peek(device: IDBFactory) {
  const storage = await Storage.open(device, "notes");
  try {
    return await storage.load();
  } finally {
    storage.close();
  }
}
