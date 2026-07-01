import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyMemory, record, supersede, join, active, forTarget } from "../src/distributed/memory.ts";

test("the same decision written by two agents converges to one entry", () => {
  const note = { type: "convention" as const, subject: "board", body: "List Int, row-major, 0=empty", targets: ["Grid"] };
  let m = record(emptyMemory(), { ...note, by: "alice" });
  m = record(m, { ...note, by: "bob" }); // identical content
  assert.equal(active(m).length, 1, "content-addressed: one convention, not two");
});

test("an agent reads the conventions and assumptions governing a def before working on it", () => {
  let m = emptyMemory();
  m = record(m, { type: "convention", subject: "board", body: "List Int", by: "a", targets: ["Grid", "solve"] });
  m = record(m, { type: "assumption", subject: "solver", body: "assumed backtracking", by: "b", targets: ["solve"] });
  m = record(m, { type: "spec", subject: "difficulty", body: "holes 40-50", by: "c", targets: ["generate"] });

  const forSolve = forTarget(m, "solve").map((n) => n.type).sort();
  assert.deepEqual(forSolve, ["assumption", "convention"]);
  assert.equal(forTarget(m, "generate").length, 1);
});

test("a superseding revision replaces the old in the view but keeps provenance", () => {
  let m = emptyMemory();
  m = record(m, { type: "spec", subject: "difficulty", body: "holes 40-50", by: "a", targets: ["generate"] });
  const old = active(m)[0];
  m = supersede(m, old.id, { type: "spec", subject: "difficulty", body: "holes 50-60", by: "a", targets: ["generate"] });

  const live = forTarget(m, "generate");
  assert.equal(live.length, 1, "only the revision is live");
  assert.equal(live[0].body, "holes 50-60");
  assert.equal(m.size, 2, "the superseded note is retained for provenance");
});

test("join is commutative and idempotent (memory gossips like the rest of the state)", () => {
  const a = record(emptyMemory(), { type: "convention", subject: "x", body: "b1", by: "alice", targets: ["f"] });
  const b = record(emptyMemory(), { type: "assumption", subject: "y", body: "b2", by: "bob", targets: ["g"] });
  const ab = join(a, b), ba = join(b, a);
  assert.deepEqual([...ab.keys()].sort(), [...ba.keys()].sort());
  assert.equal(join(ab, ab).size, ab.size);
});
