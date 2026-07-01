import { test } from "node:test";
import assert from "node:assert/strict";
import { announce, emptyHints, join, activeClaimants, shouldAvoid } from "../src/distributed/hints.ts";

test("hints are advisory: two agents can announce the same name, neither is blocked", () => {
  let h = emptyHints();
  h = announce(h, "core", "alice", 1, 100);
  h = announce(h, "core", "bob", 1, 100); // not denied — both recorded
  assert.deepEqual(activeClaimants(h, "core", 0).sort(), ["alice", "bob"]);
});

test("a hint expires (a crashed announcer never leaves a stuck lock)", () => {
  const h = announce(emptyHints(), "core", "alice", 1, 50);
  assert.deepEqual(activeClaimants(h, "core", 10), ["alice"], "live before expiry");
  assert.deepEqual(activeClaimants(h, "core", 50), [], "gone at/after expiry");
});

test("join is commutative and idempotent (gossips like the rest of the state)", () => {
  const a = announce(emptyHints(), "x", "alice", 1, 100);
  const b = announce(emptyHints(), "x", "bob", 1, 100);
  const ab = join(a, b);
  const ba = join(b, a);
  assert.deepEqual([...ab.keys()].sort(), [...ba.keys()].sort());
  assert.deepEqual([...join(ab, ab).keys()].sort(), [...ab.keys()].sort());
});

test("policy: steer away only from a hot node someone else is on; optimistic elsewhere", () => {
  const h = announce(emptyHints(), "core", "alice", 1, 100);
  // hot (fanIn 5) and alice is on it -> bob should steer away
  assert.equal(shouldAvoid(h, "core", 5, 0, "bob"), true);
  // same name, but bob himself is the claimant -> not avoided
  assert.equal(shouldAvoid(h, "core", 5, 0, "alice"), false);
  // a cold node (fanIn 1) -> pure optimistic, never avoid even if claimed
  assert.equal(shouldAvoid(h, "core", 1, 0, "bob"), false);
  // hot but the hint expired -> proceed
  assert.equal(shouldAvoid(h, "core", 5, 100, "bob"), false);
});
