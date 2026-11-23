import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const root = import.meta.dirname;

/**
 * Builds `sw.js`, the service worker (ADR-0014), from `sw.js` in this folder: it fills in
 * the list of every file the build produced and a version made from their contents, so a
 * new build is a new service worker and an unchanged build is not.
 */
function serviceWorker(): Plugin {
  return {
    name: "crdt-notes-service-worker",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      const hash = createHash("sha256");
      const files = ["./"];
      for (const [name, output] of Object.entries(bundle).sort(([a], [b]) =>
        a < b ? -1 : 1,
      )) {
        if (name.endsWith(".map")) continue;
        if (name !== "index.html") files.push(`./${name}`);
        hash.update(name).update(output.type === "chunk" ? output.code : output.source);
      }
      const publicDir = join(root, "public");
      for (const name of readdirSync(publicDir).sort()) {
        files.push(`./${name}`);
        hash.update(name).update(readFileSync(join(publicDir, name)));
      }
      const source = readFileSync(join(root, "sw.js"), "utf8")
        .replace("const FILES = __FILES__;", `const FILES = ${JSON.stringify(files)};`)
        .replace(
          "const VERSION = __VERSION__;",
          `const VERSION = ${JSON.stringify(hash.digest("hex").slice(0, 12))};`,
        );
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [react(), serviceWorker()],
  server: { port: 5173 },
  preview: { port: 4173 },
});
