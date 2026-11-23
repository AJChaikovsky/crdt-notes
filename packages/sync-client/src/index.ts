/**
 * One document on one device (ADR-0010): the CRDT (Conflict-free Replicated Data Type),
 * saved to IndexedDB and synced with the server.
 */
export { SyncClient, type ClientOptions } from "./client.js";
export { Storage, type Saved } from "./storage.js";
