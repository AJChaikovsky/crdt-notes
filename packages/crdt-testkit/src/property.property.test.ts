import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { propertyParameters } from "./property.js";

// Proves the property-test wiring works end to end before any CRDT code exists.
describe("property harness", () => {
  it("reversing an array twice gives the original array", () => {
    fc.assert(
      fc.property(fc.array(fc.integer()), (xs) => {
        expect([...xs].reverse().reverse()).toEqual(xs);
      }),
      propertyParameters(),
    );
  });
});
