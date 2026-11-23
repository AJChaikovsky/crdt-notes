import { appendFileSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FastFugue } from "@crdt-notes/crdt";
import {
  decodeMessage,
  encodeMessage,
  OpLog,
  type Entry,
  type Message,
} from "@crdt-notes/sync-protocol";
import { WebSocket } from "ws";
import { startServer, type SyncServer } from "./server.js";
import { DocStore } from "./store.js";

let dataDir: string;
let server: SyncServer | null = null;
const sockets: WebSocket[] = [];

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "crdt-notes-server-"));
});

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  await server?.close();
  server = null;
  rmSync(dataDir, { recursive: true, force: true });
});

async function start(): Promise<SyncServer> {
  server = await startServer({ port: 0, dataDir });
  return server;
}

/** A test client: a socket plus a queue of decoded messages to await one by one. */
async function connect(port: number) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  sockets.push(socket);
  const inbox: Message[] = [];
  const waiting: ((m: Message) => void)[] = [];
  socket.on("message", (data) => {
    const message = decodeMessage(String(data));
    const wake = waiting.shift();
    if (wake === undefined) inbox.push(message);
    else wake(message);
  });
  const closed = new Promise<number>((resolve) => socket.on("close", resolve));
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return {
    send: (message: Message) => socket.send(encodeMessage(message)),
    raw: (text: string) => socket.send(text),
    next: () =>
      new Promise<Message>((resolve) => {
        const ready = inbox.shift();
        if (ready === undefined) waiting.push(resolve);
        else resolve(ready);
      }),
    closed,
    /** Messages received but not yet taken with `next`. */
    queued: () => inbox.length,
  };
}

/** A replica as a client would hold it: the document and its op log. */
function replica(id: string) {
  const doc = new FastFugue(id);
  const log = new OpLog();
  return {
    doc,
    log,
    type(index: number, text: string): Entry[] {
      return [...text].map((char, i) => log.append(doc.insertAt(index + i, char)));
    },
    receive(entries: readonly Entry[]) {
      for (const entry of entries) if (log.add(entry)) doc.apply(entry.op);
    },
  };
}

function entriesOf(message: Message): readonly Entry[] {
  if (message.type !== "ops") throw new Error(`expected ops, got ${message.type}`);
  return message.entries;
}

describe("sync server", () => {
  it("relays one client's edits to another client of the same document", async () => {
    const { port } = await start();
    const alice = replica("A");
    const bob = replica("B");
    const a = await connect(port);
    const b = await connect(port);
    a.send({ type: "hello", doc: "notes", vector: alice.log.vector() });
    b.send({ type: "hello", doc: "notes", vector: bob.log.vector() });
    expect((await a.next()).type).toBe("welcome");
    expect((await b.next()).type).toBe("welcome");

    a.send({ type: "ops", entries: alice.type(0, "hi") });
    bob.receive(entriesOf(await b.next()));
    expect(bob.doc.text()).toBe("hi");
  });

  it("doesn't relay to clients of other documents", async () => {
    const { port } = await start();
    const a = await connect(port);
    const c = await connect(port);
    a.send({ type: "hello", doc: "notes", vector: new Map() });
    c.send({ type: "hello", doc: "other", vector: new Map() });
    await a.next();
    await c.next();
    a.send({ type: "ops", entries: replica("A").type(0, "x") });
    // A later message on "other" must be the first thing c receives.
    const c2 = await connect(port);
    c2.send({ type: "hello", doc: "other", vector: new Map() });
    await c2.next();
    c2.send({ type: "ops", entries: replica("C").type(0, "y") });
    const first = entriesOf(await c.next());
    expect(first.map((e) => e.op.id.replica)).toEqual(["C"]);
  });

  it("catches a reconnecting client up, and takes what it typed offline", async () => {
    const { port } = await start();
    const alice = replica("A");
    const bob = replica("B");
    const b = await connect(port);
    b.send({ type: "hello", doc: "notes", vector: bob.log.vector() });
    await b.next();
    b.send({ type: "ops", entries: bob.type(0, "bob") });

    alice.type(0, "alice "); // offline
    const a = await connect(port);
    a.send({ type: "hello", doc: "notes", vector: alice.log.vector() });
    const welcome = await a.next();
    if (welcome.type !== "welcome") throw new Error("expected welcome");
    alice.receive(entriesOf(await a.next()));
    a.send({ type: "ops", entries: alice.log.missing(welcome.vector) });
    bob.receive(entriesOf(await b.next()));

    expect(alice.doc.text()).toBe(bob.doc.text());
    expect(alice.log.vector()).toEqual(bob.log.vector());
  });

  it("keeps every document's log across a restart", async () => {
    const first = await start();
    const alice = replica("A");
    const a = await connect(first.port);
    a.send({ type: "hello", doc: "notes", vector: new Map() });
    await a.next();
    a.send({ type: "ops", entries: alice.type(0, "saved") });
    // A second hello on the same socket is refused; waiting for that close also
    // guarantees the server has handled the ops sent before it.
    a.send({ type: "hello", doc: "notes", vector: new Map() });
    expect(await a.closed).toBe(1008);
    await first.close();

    const second = await start();
    const bob = replica("B");
    const b = await connect(second.port);
    b.send({ type: "hello", doc: "notes", vector: bob.log.vector() });
    await b.next();
    bob.receive(entriesOf(await b.next()));
    expect(bob.doc.text()).toBe("saved");
  });

  it("closes the connection on a malformed message, or ops before hello", async () => {
    const { port } = await start();
    const bad = await connect(port);
    bad.raw("{not json");
    expect(await bad.closed).toBe(1008);
    const early = await connect(port);
    early.send({ type: "ops", entries: [] });
    expect(await early.closed).toBe(1008);
  });
});

describe("presence", () => {
  const cursor = (counter: number) => ({
    anchor: { counter, replica: "A" },
    head: { counter, replica: "A" },
  });

  it("relays cursors to the other clients, shows newcomers, and says when one leaves", async () => {
    const { port } = await start();
    const a = await connect(port);
    const b = await connect(port);
    a.send({ type: "hello", doc: "notes", vector: new Map() });
    b.send({ type: "hello", doc: "notes", vector: new Map() });
    await a.next();
    await b.next();

    a.send({ type: "presence", replica: "A", selection: cursor(1) });
    expect(await b.next()).toEqual({
      type: "presence",
      replica: "A",
      selection: cursor(1),
    });

    const c = await connect(port);
    c.send({ type: "hello", doc: "notes", vector: new Map() });
    expect((await c.next()).type).toBe("welcome");
    expect(await c.next()).toEqual({
      type: "presence",
      replica: "A",
      selection: cursor(1),
    });

    sockets[0]?.close(); // a leaves
    expect(await b.next()).toEqual({ type: "presence", replica: "A", selection: null });
    expect(await c.next()).toEqual({ type: "presence", replica: "A", selection: null });
  });

  it("doesn't save cursors: a restart forgets them", async () => {
    const first = await start();
    const a = await connect(first.port);
    a.send({ type: "hello", doc: "notes", vector: new Map() });
    await a.next();
    a.send({ type: "presence", replica: "A", selection: cursor(1) });
    a.send({ type: "hello", doc: "notes", vector: new Map() }); // refused: flushes the above
    await a.closed;
    await first.close();
    const second = await start();
    const b = await connect(second.port);
    b.send({ type: "hello", doc: "notes", vector: new Map() });
    expect((await b.next()).type).toBe("welcome");
    b.send({ type: "presence", replica: "B", selection: null });
    b.send({ type: "hello", doc: "notes", vector: new Map() });
    expect(await b.closed).toBe(1008);
    expect(b.queued()).toBe(0); // no remembered cursor from before the restart
  });
});

describe("DocStore", () => {
  it("drops a line cut off by a crash, and appends cleanly after it", () => {
    const store = new DocStore(dataDir);
    const alice = replica("A");
    const entries = alice.type(0, "abc");
    store.append("notes", entries.slice(0, 2));
    const [file] = readdirSync(dataDir);
    if (file === undefined) throw new Error("no file written");
    appendFileSync(join(dataDir, file), '{"v":1,"seq":3,"op":{"ki'); // the crash
    expect(store.load("notes").size).toBe(2);

    store.append("notes", entries.slice(2));
    expect(store.load("notes").size).toBe(3);
    expect(readFileSync(join(dataDir, file), "utf8").split("\n")).toHaveLength(4);
  });

  it("keeps a document named like a path inside its folder", () => {
    const store = new DocStore(dataDir);
    store.append("../../escape", replica("A").type(0, "x"));
    expect(readdirSync(dataDir)).toHaveLength(1);
    expect(store.load("../../escape").size).toBe(1);
  });
});
