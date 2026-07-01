import { test } from "node:test";
import assert from "node:assert/strict";
import { partition, type GraphNode } from "../src/swarm/partition.ts";

/** A barbell: two dense clusters joined by a single bridge edge — one connected
 *  component, but with an obvious weak seam. */
function barbell(): GraphNode[] {
  const cluster = (p: string) => {
    const ids = [0, 1, 2, 3, 4].map((i) => `${p}${i}`);
    return ids.map((id) => ({ id, label: id, deps: ids.filter((x) => x !== id) }));
  };
  const a = cluster("a");
  const b = cluster("b");
  a[0].deps.push("b0"); // the single bridge
  return [...a, ...b];
}

test("cuts inside a single connected component along the weak seam", () => {
  const { buckets, cut } = partition(barbell(), 2);
  assert.equal(buckets.length, 2);
  assert.deepEqual(buckets.map((b) => b.length).sort(), [5, 5], "balanced 5/5, not 10/0");

  const bucketOf = new Map<string, number>();
  buckets.forEach((bk, i) => bk.forEach((id) => bucketOf.set(id, i)));
  assert.equal(bucketOf.get("a0"), bucketOf.get("a4"), "cluster a stays together");
  assert.equal(bucketOf.get("b0"), bucketOf.get("b4"), "cluster b stays together");
  assert.notEqual(bucketOf.get("a1"), bucketOf.get("b1"), "the two clusters split apart");
  assert.equal(cut, 1, "only the bridge edge is cut");
});

test("surfaces fan-in centrality (the hot, most-depended-on nodes)", () => {
  const nodes: GraphNode[] = [
    { id: "core", label: "core", deps: [] },
    { id: "u1", label: "u1", deps: ["core"] },
    { id: "u2", label: "u2", deps: ["core"] },
    { id: "u3", label: "u3", deps: ["core", "u1"] },
  ];
  const { centrality } = partition(nodes, 2);
  assert.equal(centrality[0].id, "core");
  assert.equal(centrality[0].fanIn, 3, "three definitions depend on core");
});
