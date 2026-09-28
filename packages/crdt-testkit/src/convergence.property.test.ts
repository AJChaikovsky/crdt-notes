import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { propertyParameters } from "./property.js";
import { run, scenario, withoutDuplicates } from "./scenario.js";

// Properties from docs/testing-strategy.md, over random scenarios with causally valid
// delivery.
describe("convergence", () => {
  it("P1: once every op is delivered everywhere, every replica has the same text", () => {
    fc.assert(
      fc.property(scenario(), (s) => {
        const texts = run(s).texts();
        for (const text of texts) expect(text).toBe(texts[0]);
      }),
      propertyParameters(),
    );
  });

  it("P2: receiving an op again changes nothing", () => {
    fc.assert(
      fc.property(
        scenario().filter((s) => s.steps.some((step) => step.kind === "redeliver")),
        (s) => {
          // Each replica must end exactly where it would have if no op had been duplicated.
          expect(run(s).texts()).toEqual(run(withoutDuplicates(s)).texts());
        },
      ),
      propertyParameters(),
    );
  });
});
