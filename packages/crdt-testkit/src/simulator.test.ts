import { describe, expect, it } from "vitest";
import { rga } from "./implementation.js";
import { Simulator } from "./simulator.js";

describe("Simulator", () => {
  it("delivers an op everywhere and converges", () => {
    const sim = new Simulator(rga, ["A", "B", "C"]);
    sim.edit(0, { kind: "insert", index: 0, char: "H" });
    sim.edit(0, { kind: "insert", index: 1, char: "i" });
    expect(sim.pendingCount).toBe(4);
    sim.deliverAll();
    expect(sim.texts()).toEqual(["Hi", "Hi", "Hi"]);
  });

  it("holds an op back until everything its author had seen has arrived", () => {
    // Bob types "x"; Alice sees it and types "y". Carol must not get "y" before "x".
    const sim = new Simulator(rga, ["A", "B", "C"]);
    sim.edit(1, { kind: "insert", index: 0, char: "x" });
    const toAlice = sim.deliverable().find((d) => d.to === 0);
    if (toAlice === undefined) throw new Error("expected a delivery to Alice");
    sim.deliver(toAlice);
    sim.edit(0, { kind: "insert", index: 0, char: "y" }); // origin null, but depends on "x"

    const ready = sim.deliverable();
    const yToCarol = ready.find((d) => d.to === 2 && d.sent.op.id.replica === "A");
    expect(yToCarol).toBeUndefined();

    sim.deliverAll();
    expect(new Set(sim.texts()).size).toBe(1);
  });

  it("refuses a delivery that isn't causally ready", () => {
    // B sees A's "a", then types "b". Delivering "b" to C before "a" must throw.
    const sim = new Simulator(rga, ["A", "B", "C"]);
    sim.edit(0, { kind: "insert", index: 0, char: "a" });
    const toB = sim.deliverable().find((d) => d.to === 1);
    if (toB === undefined) throw new Error("expected a delivery to B");
    sim.deliver(toB);
    sim.edit(1, { kind: "insert", index: 1, char: "b" });

    const bToC = sim.pending().find((d) => d.to === 2 && d.sent.op.id.replica === "B");
    if (bToC === undefined) throw new Error("expected b to be pending for C");
    expect(() => sim.deliver(bToC)).toThrow(/not causally ready/);
  });

  it("any order of ready deliveries converges for concurrent edits", () => {
    for (let seed = 0; seed < 6; seed += 1) {
      const sim = new Simulator(rga, ["A", "B", "C"]);
      sim.edit(0, { kind: "insert", index: 0, char: "a" });
      sim.edit(1, { kind: "insert", index: 0, char: "b" });
      sim.edit(2, { kind: "insert", index: 0, char: "c" });
      sim.deliverAll((n) => seed % n);
      expect(new Set(sim.texts()).size).toBe(1);
    }
  });

  it("clamps out-of-range edits and ignores deletes on an empty document", () => {
    const sim = new Simulator(rga, ["A", "B"]);
    expect(sim.edit(0, { kind: "delete", index: 3 })).toBeNull();
    sim.edit(0, { kind: "insert", index: 99, char: "a" });
    sim.edit(0, { kind: "delete", index: 5 });
    sim.deliverAll();
    expect(sim.texts()).toEqual(["", ""]);
  });

  it("redelivers only ops a replica already has, including its own", () => {
    const sim = new Simulator(rga, ["A", "B"]);
    expect(sim.redeliver(0, 0)).toBeNull();
    const a = sim.edit(0, { kind: "insert", index: 0, char: "a" });
    expect(sim.redeliver(1, 0)).toBeNull(); // B hasn't received "a" yet
    expect(sim.redeliver(0, 7)).toBe(a); // A's own op, echoed back
    expect(sim.texts()).toEqual(["a", ""]);
    sim.deliverAll();
    expect(sim.redeliver(1, 0)).toBe(a);
    expect(sim.texts()).toEqual(["a", "a"]);
  });
});
