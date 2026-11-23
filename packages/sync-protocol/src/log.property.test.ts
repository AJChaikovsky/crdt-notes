import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DecodeError, type FugueOp } from "@crdt-notes/crdt";
import { OpLog, type Entry, type VersionVector } from "./log.js";
import { decodeMessage, encodeMessage, type Message } from "./messages.js";

// Same settings as the CRDT properties: NUM_RUNS cases (100 locally, 10,000 in CI),
// with the seed printed so a failure can be replayed with SEED.
function parameters<T>(): fc.Parameters<T> {
  const numRuns = Number(process.env["NUM_RUNS"] ?? 100);
  const seed =
    process.env["SEED"] === undefined ? Date.now() : Number(process.env["SEED"]);
  console.info(`fast-check: numRuns=${numRuns} seed=${seed}`);
  return { numRuns, seed };
}

const AUTHORS = ["A", "B", "C"] as const;

/** An entry for `author`'s op number `seq`. The log never looks inside the op. */
function entry(author: string, seq: number): Entry {
  const op: FugueOp = {
    kind: "delete",
    id: { counter: seq * 3, replica: author },
    target: { counter: 1, replica: "A" },
  };
  return { seq, op };
}

/** Every op of up to 3 authors with up to 12 ops each. */
const universe: fc.Arbitrary<Entry[]> = fc
  .tuple(...AUTHORS.map(() => fc.nat({ max: 12 })))
  .map((counts) =>
    counts.flatMap((count, a) =>
      Array.from({ length: count }, (_, i) => entry(AUTHORS[a] ?? "?", i + 1)),
    ),
  );

/** A log holding some of the universe, added in any order, gaps included. */
const partOf = (all: Entry[]): fc.Arbitrary<Entry[]> =>
  fc.shuffledSubarray(all, { minLength: 0, maxLength: all.length });

const ids = (entries: Entry[]): string[] =>
  entries.map(({ seq, op }) => `${op.id.replica}:${seq}`);

describe("OpLog", () => {
  it("keeps each author's vector entry at the end of the unbroken run from 1", () => {
    fc.assert(
      fc.property(
        universe.chain((all) => partOf(all)),
        (added) => {
          const log = new OpLog();
          for (const e of added) log.add(e);
          for (const author of AUTHORS) {
            const held = new Set(
              added.filter((e) => e.op.id.replica === author).map((e) => e.seq),
            );
            let run = 0;
            while (held.has(run + 1)) run += 1;
            expect(log.vector().get(author) ?? 0).toBe(run);
          }
          expect(log.size).toBe(added.length);
        },
      ),
      parameters(),
    );
  });

  it("two sides that each send the other what its vector lacks end up holding the union", () => {
    fc.assert(
      fc.property(
        universe.chain((all) => fc.tuple(partOf(all), partOf(all))),
        ([mine, theirs]) => {
          const a = new OpLog();
          const b = new OpLog();
          for (const e of mine) a.add(e);
          for (const e of theirs) b.add(e);
          // Both vectors are read before either side changes, as on a real reconnect.
          const toB = a.missing(b.vector());
          const toA = b.missing(a.vector());
          for (const e of toB) b.add(e);
          for (const e of toA) a.add(e);

          const union = new Set(ids([...mine, ...theirs]));
          expect(new Set(ids(a.entries()))).toEqual(union);
          expect(ids(b.entries())).toEqual(ids(a.entries()));
          expect(b.vector()).toEqual(a.vector());
        },
      ),
      parameters(),
    );
  });

  it("sends each author's missing ops in the order they were made", () => {
    fc.assert(
      fc.property(
        universe.chain((all) => partOf(all)),
        (added) => {
          const log = new OpLog();
          for (const e of added) log.add(e);
          const sent = log.missing(new Map());
          for (const author of AUTHORS) {
            const seqs = sent.filter((e) => e.op.id.replica === author).map((e) => e.seq);
            expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
          }
        },
      ),
      parameters(),
    );
  });

  it("numbers local ops 1, 2, 3 and refuses to number one across a gap", () => {
    const log = new OpLog();
    expect(log.append(entry("A", 99).op).seq).toBe(1);
    expect(log.append(entry("A", 99).op).seq).toBe(2);
    log.add(entry("A", 4));
    expect(() => log.append(entry("A", 99).op)).toThrow(/gap/);
  });

  it("ignores a second entry with the same author and seq", () => {
    const log = new OpLog();
    expect(log.add(entry("A", 1))).toBe(true);
    expect(log.add(entry("A", 1))).toBe(false);
    expect(log.size).toBe(1);
  });
});

const vector: fc.Arbitrary<VersionVector> = fc
  .uniqueArray(
    fc.tuple(
      fc.string({ unit: "binary" }),
      fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }),
    ),
    { selector: ([replica]) => replica, maxLength: 5 },
  )
  .map((pairs) => new Map(pairs));

const anchorId = fc.record({
  counter: fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }),
  replica: fc.string({ unit: "binary" }),
});

const message: fc.Arbitrary<Message> = fc.oneof(
  fc.record({ type: fc.constant("hello" as const), doc: fc.string(), vector }),
  fc.record({ type: fc.constant("welcome" as const), vector }),
  universe.map((entries) => ({ type: "ops" as const, entries })),
  fc.record({
    type: fc.constant("presence" as const),
    replica: fc.string(),
    selection: fc.option(
      fc.record({
        anchor: fc.option(anchorId, { nil: null }),
        head: fc.option(anchorId, { nil: null }),
      }),
      { nil: null },
    ),
  }),
);

describe("sync messages", () => {
  it("decode to an equal message", () => {
    fc.assert(
      fc.property(message, (m) => {
        expect(decodeMessage(encodeMessage(m))).toEqual(m);
      }),
      parameters(),
    );
  });

  it("reject random input with a DecodeError, or read a message that round-trips", () => {
    const broken = fc
      .tuple(
        message,
        fc.constantFrom(
          "v",
          "type",
          "doc",
          "vector",
          "entries",
          "replica",
          "selection",
          "extra",
        ),
        fc.jsonValue(),
      )
      .map(([m, field, value]) => {
        const object = JSON.parse(encodeMessage(m)) as Record<string, unknown>;
        object[field] = value;
        return JSON.stringify(object);
      });
    const garbage = fc.oneof(
      fc.string({ unit: "binary" }),
      fc.jsonValue().map((value) => JSON.stringify(value)),
      broken,
    );
    fc.assert(
      fc.property(garbage, (text) => {
        let decoded: Message;
        try {
          decoded = decodeMessage(text);
        } catch (error) {
          expect(error).toBeInstanceOf(DecodeError);
          return;
        }
        expect(decodeMessage(encodeMessage(decoded))).toEqual(decoded);
      }),
      parameters(),
    );
  });

  it("carry a replica named __proto__ safely", () => {
    const m: Message = { type: "welcome", vector: new Map([["__proto__", 3]]) };
    expect(decodeMessage(encodeMessage(m))).toEqual(m);
  });

  it("reject a vector naming the same replica twice", () => {
    expect(() =>
      decodeMessage('{"v":1,"type":"welcome","vector":[["A",1],["A",2]]}'),
    ).toThrow(DecodeError);
  });
});
