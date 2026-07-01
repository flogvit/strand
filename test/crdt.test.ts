import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyNamespace,
  join,
  observe,
  resolve,
  view,
  type CrdtNamespace,
} from "../src/distributed/crdt.ts";

/** Canonical serialization so two converged states compare equal regardless of
 *  the order they were built in. */
function canon(s: CrdtNamespace): string {
  const entries = [...s.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, st]) => [name, st.obs, st.resolution ?? null]);
  return JSON.stringify(entries);
}

const o = (by: string, hash: string, intent = "") => ({ by, hash, intent });

function sample(): CrdtNamespace {
  let s = emptyNamespace();
  s = observe(s, "add", o("alice", "h_add"));
  s = observe(s, "double", o("bob", "h_double"));
  s = observe(s, "greet", o("alice", "h_greet1"));
  s = observe(s, "greet", o("carol", "h_greet2")); // contended
  return s;
}

test("join is commutative", () => {
  const a = observe(observe(emptyNamespace(), "x", o("a", "h1")), "y", o("a", "h2"));
  const b = observe(observe(emptyNamespace(), "y", o("b", "h2")), "z", o("b", "h3"));
  assert.equal(canon(join(a, b)), canon(join(b, a)));
});

test("join is associative", () => {
  const a = observe(emptyNamespace(), "x", o("a", "h1"));
  const b = observe(emptyNamespace(), "x", o("b", "h2"));
  const c = observe(emptyNamespace(), "y", o("c", "h3"));
  assert.equal(canon(join(join(a, b), c)), canon(join(a, join(b, c))));
});

test("join is idempotent", () => {
  const a = sample();
  assert.equal(canon(join(a, a)), canon(a));
});

test("independent names merge; same name+hash converges; same name+different hash parks", () => {
  const { namespace, conflicts } = view(sample());
  assert.equal(namespace.get("add")?.hash, "h_add");
  assert.equal(namespace.get("double")?.hash, "h_double");
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].name, "greet");

  // the same content observed by two authors is NOT a conflict
  const conv = observe(observe(emptyNamespace(), "id", o("a", "h_id")), "id", o("b", "h_id"));
  assert.equal(view(conv).conflicts.length, 0);
  assert.equal(view(conv).namespace.get("id")?.hash, "h_id");
});

test("a resolution collapses a park and converges regardless of join order", () => {
  const base = sample(); // greet is parked between h_greet1 and h_greet2
  const resolved = resolve(base, "greet", "h_greet2", "human", 1);

  // resolution visible in the view, park gone
  const v = view(resolved);
  assert.equal(v.conflicts.length, 0);
  assert.equal(v.namespace.get("greet")?.hash, "h_greet2");

  // a peer that only saw the resolution, joined either way, agrees
  const justResolution = resolve(emptyNamespace(), "greet", "h_greet2", "human", 1);
  assert.equal(canon(join(base, justResolution)), canon(join(justResolution, base)));
  assert.equal(view(join(justResolution, base)).namespace.get("greet")?.hash, "h_greet2");
});

test("a later resolution supersedes an earlier one, in any order", () => {
  const base = sample();
  const r1 = resolve(base, "greet", "h_greet1", "alice", 1);
  const r2 = resolve(base, "greet", "h_greet2", "bob", 2); // higher seq wins
  assert.equal(view(join(r1, r2)).namespace.get("greet")?.hash, "h_greet2");
  assert.equal(view(join(r2, r1)).namespace.get("greet")?.hash, "h_greet2");
});
