import js from "@eslint/js";
import tseslint from "typescript-eslint";

// Libraries that implement a CRDT (Conflict-free Replicated Data Type) for us.
// They are reference material and comparison targets, never imports in the core.
const crdtLibraries = ["yjs", "automerge", "@automerge/*", "loro-crdt", "diamond-types*"];

export default tseslint.config(
  { ignores: ["**/node_modules/", "**/dist/", "coverage/"] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ["packages/crdt/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: crdtLibraries,
              message: "packages/crdt implements the CRDT from scratch. See CLAUDE.md.",
            },
          ],
        },
      ],
    },
  },
);
