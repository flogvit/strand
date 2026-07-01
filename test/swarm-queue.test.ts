import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileQueue } from "../src/swarm/queue.ts";

function freshQueue(): FileQueue {
  return new FileQueue(mkdtempSync(join(tmpdir(), "strand-swarm-")));
}

test("a blocked dependency is not claimable until its dep is done", () => {
  const q = freshQueue();
  const grid = q.add({ title: "Grid model", role: "code", intent: "grid", target: ["Grid"], deps: [] });
  const valid = q.add({ title: "valid placement", role: "code", intent: "valid", target: ["valid"], deps: [grid.id] });

  // Only the dependency-free task can be claimed first.
  const first = q.claim("w1");
  assert.equal(first?.id, grid.id);
  assert.equal(q.claim("w2"), undefined, "the dependent is still blocked");

  // Completing the dep unblocks the dependent.
  q.report(grid.id, { state: "done" });
  const second = q.claim("w2");
  assert.equal(second?.id, valid.id);
});

test("a task is claimed by exactly one worker", () => {
  const q = freshQueue();
  q.add({ title: "solo", role: "code", intent: "x", target: ["x"], deps: [] });

  const a = q.claim("w1");
  const b = q.claim("w2");
  assert.ok(a, "first worker gets the task");
  assert.equal(b, undefined, "second worker gets nothing — no double assignment");
  assert.equal(q.get(a!.id)?.assignee, "w1");
});

test("a parked task is freed for reclaim when unassigned", () => {
  const q = freshQueue();
  const t = q.add({ title: "hard", role: "code", intent: "x", target: ["x"], deps: [] });

  const claimed = q.claim("w1");
  assert.equal(claimed?.id, t.id);

  // Worker parks it (e.g. green-gate rejected) and hands it back.
  q.report(t.id, { state: "ready", unassign: true, comment: "type error, retry" });
  const reclaimed = q.claim("w2");
  assert.equal(reclaimed?.id, t.id, "another worker can pick the parked task up");
  assert.equal(reclaimed?.assignee, "w2");
});
