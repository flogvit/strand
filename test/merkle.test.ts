import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIndex, reconcile } from "../src/distributed/merkle.ts";

const objs = (n: number, prefix = "obj") => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

test("identical stores reconcile to nothing, visiting only the root", () => {
  const hs = objs(200);
  const r = reconcile(buildIndex(hs), buildIndex(hs));
  assert.deepEqual(r.missingFromA, []);
  assert.deepEqual(r.missingFromB, []);
  assert.equal(r.nodesVisited, 1, "equal root digest prunes the whole tree");
});

test("a one-object difference is found by visiting O(diff) nodes, not the whole store", () => {
  const shared = objs(200);
  const a = buildIndex(shared);
  const b = buildIndex([...shared, "extra-on-b"]);

  const r = reconcile(a, b);
  assert.deepEqual(r.missingFromA, ["extra-on-b"], "a is missing the extra object");
  assert.deepEqual(r.missingFromB, [], "b lacks nothing a has");
  // Matching subtrees are pruned: we compare a handful of digests near the top and
  // descend only the path to the differing leaf — never opening the other buckets'
  // member lists. Visited count stays far below the object count (200).
  assert.ok(r.nodesVisited < 40, `visited ${r.nodesVisited} nodes, far below the ${shared.length}-object store`);
});

test("divergent stores reconcile symmetrically", () => {
  const shared = objs(50);
  const a = buildIndex([...shared, "only-a-1", "only-a-2"]);
  const b = buildIndex([...shared, "only-b-1"]);

  const r = reconcile(a, b);
  assert.deepEqual(r.missingFromA.sort(), ["only-b-1"]);
  assert.deepEqual(r.missingFromB.sort(), ["only-a-1", "only-a-2"]);
});
