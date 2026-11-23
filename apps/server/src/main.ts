import { startServer } from "./server.js";

// `pnpm dev:server`: PORT (default 8787) and DATA_DIR (default ./data).
const port = Number(process.env["PORT"] ?? 8787);
const dataDir = process.env["DATA_DIR"] ?? "data";
const server = await startServer({ port, dataDir });
console.info(
  `crdt-notes sync server on ws://localhost:${server.port}, data in ${dataDir}`,
);
