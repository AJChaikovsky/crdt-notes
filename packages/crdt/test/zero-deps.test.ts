import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as Record<string, unknown>;

describe("@crdt-notes/crdt", () => {
  it("has zero runtime dependencies", () => {
    expect(manifest["dependencies"] ?? {}).toEqual({});
    expect(manifest["peerDependencies"] ?? {}).toEqual({});
    expect(manifest["optionalDependencies"] ?? {}).toEqual({});
  });
});
