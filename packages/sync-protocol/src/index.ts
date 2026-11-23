/**
 * Sync between replicas, shared by `apps/server` and `apps/web` (ADR-0008): the op log
 * each side keeps, its version vector, and the messages they exchange.
 */
export { OpLog, type Entry, type VersionVector } from "./log.js";
export {
  decodeEntry,
  decodeMessage,
  encodeEntry,
  encodeMessage,
  type Message,
} from "./messages.js";
