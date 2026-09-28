import { describe, expect, it } from "vitest";
import { Clock } from "./clock.js";

describe("Clock", () => {
  it("starts at 0 and stamps IDs 1, 2, 3 with its own replica", () => {
    const clock = new Clock("A");
    expect(clock.counter).toBe(0);
    expect(clock.tick()).toEqual({ counter: 1, replica: "A" });
    expect(clock.tick()).toEqual({ counter: 2, replica: "A" });
    expect(clock.tick()).toEqual({ counter: 3, replica: "A" });
  });

  it("jumps to a bigger remote counter, so the next local ID beats it", () => {
    const bob = new Clock("B");
    bob.observe({ counter: 10, replica: "A" });
    expect(bob.tick()).toEqual({ counter: 11, replica: "B" });
  });

  it("ignores a smaller remote counter", () => {
    const bob = new Clock("B");
    bob.tick();
    bob.tick();
    bob.tick();
    bob.observe({ counter: 1, replica: "A" });
    expect(bob.tick()).toEqual({ counter: 4, replica: "B" });
  });

  it("gives an op a bigger counter than every op its author had seen", () => {
    const alice = new Clock("A");
    const bob = new Clock("B");
    const seen = [alice.tick(), alice.tick(), alice.tick()];
    for (const op of seen) bob.observe(op);
    const next = bob.tick();
    for (const op of seen) expect(next.counter).toBeGreaterThan(op.counter);
  });
});
