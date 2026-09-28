import { describe, expect, it } from "vitest";
import { compareIds, type Id } from "./id.js";

const id = (counter: number, replica: string): Id => ({ counter, replica });

describe("compareIds", () => {
  it("orders by counter first, whatever the replica", () => {
    expect(compareIds(id(2, "Z"), id(3, "A"))).toBeLessThan(0);
    expect(compareIds(id(3, "A"), id(2, "Z"))).toBeGreaterThan(0);
  });

  it("breaks counter ties by replica ID", () => {
    expect(compareIds(id(3, "A"), id(3, "B"))).toBeLessThan(0);
    expect(compareIds(id(3, "B"), id(3, "A"))).toBeGreaterThan(0);
  });

  it("returns 0 only for the same ID", () => {
    expect(compareIds(id(3, "A"), id(3, "A"))).toBe(0);
  });

  it("compares replica IDs by code unit, not locale", () => {
    // localeCompare would put "a" before "B"; code-unit order puts "B" (66) before "a" (97).
    expect(compareIds(id(1, "B"), id(1, "a"))).toBeLessThan(0);
  });

  it("gives the same order whatever order the IDs arrive in", () => {
    const ids = [id(2, "B"), id(1, "A"), id(2, "A"), id(1, "B")];
    const expected = [id(1, "A"), id(1, "B"), id(2, "A"), id(2, "B")];
    expect([...ids].sort(compareIds)).toEqual(expected);
    expect([...ids].reverse().sort(compareIds)).toEqual(expected);
  });
});
