/**
 * The list CRDT (Conflict-free Replicated Data Type) core: RGA (Replicated Growable
 * Array), per ADR-0001 in `docs/decisions/`.
 *
 * This package has zero runtime dependencies; `test/zero-deps.test.ts` enforces it.
 */
export { Clock } from "./clock.js";
export { compareIds, type Id, type ReplicaId } from "./id.js";
export { Fugue, type FugueInsertOp, type FugueOp } from "./fugue.js";
export { Rga, type DeleteOp, type InsertOp, type ItemView, type Op } from "./rga.js";
