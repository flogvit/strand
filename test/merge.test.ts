import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/core/store.ts";
import { compileProgram } from "../src/pipeline.ts";
import { merge, resolveConflict } from "../src/merge.ts";
import type { Namespace, PendingTx } from "../src/model.ts";
import type { Hash } from "../src/core/term.ts";

// Compile one agent's source into the shared store and return a pending tx.
function submit(store: Store, base: Namespace, by: string, intent: string, src: string): PendingTx {
  const names = new Map<string, Hash>([...base].map(([n, b]) => [n, b.hash]));
  const binds = compileProgram(src, store, names);
  return { by, intent, binds };
}

test("independent definitions auto-merge with zero conflicts", () => {
  const store = new Store();
  const base: Namespace = new Map();
  const tx1 = submit(store, base, "agent-1", "add a", "def a -> Int = 1");
  const tx2 = submit(store, base, "agent-2", "add b", "def b -> Int = 2");
  const r = merge(base, store, [tx1, tx2]);
  assert.deepEqual(r.applied.sort(), ["a", "b"]);
  assert.equal(r.conflicts.length, 0);
});

test("same name + different content = one parked conflict; other names still apply", () => {
  const store = new Store();
  const base: Namespace = new Map();
  const tx1 = submit(store, base, "agent-1", "signup v1 + login", "def signup -> Int = 1\ndef login -> Int = 9");
  const tx2 = submit(store, base, "agent-2", "signup v2", "def signup -> Int = 2");
  const r = merge(base, store, [tx1, tx2]);
  assert.equal(r.conflicts.length, 1);
  assert.equal(r.conflicts[0].name, "signup");
  assert.ok(r.applied.includes("login")); // independent name unaffected
});

test("convergent edits (same name, same content) are not a conflict", () => {
  const store = new Store();
  const base: Namespace = new Map();
  const tx1 = submit(store, base, "agent-1", "same", "def signup -> Int = 1");
  const tx2 = submit(store, base, "agent-2", "same", "def signup -> Int = 1");
  const r = merge(base, store, [tx1, tx2]);
  assert.equal(r.conflicts.length, 0);
  assert.deepEqual(r.applied, ["signup"]);
});

test("a caller pinned to a dependency's hash survives a rebind of that name", () => {
  const store = new Store();
  // base: foo = v1
  const base: Namespace = new Map();
  const fooTx = submit(store, base, "seed", "foo v1", "def foo -> Int = 1");
  const afterFoo = merge(base, store, [fooTx]).namespace;
  // agent Y writes bar that uses foo (compiles against foo = v1, pinning that hash)
  const txY = submit(store, afterFoo, "agent-Y", "bar uses foo", "def bar -> Int = foo + 10");
  // agent X rebinds foo to v2
  const txX = submit(store, afterFoo, "agent-X", "foo v2", "def foo -> Int = 2");
  const r = merge(afterFoo, store, [txX, txY]);
  const barHash = r.applied.includes("bar") ? r.namespace.get("bar")!.hash : undefined;
  assert.ok(barHash, "bar should be applied");
  // foo now points at v2, but bar still resolves because it pinned v1's hash
  assert.notEqual(r.namespace.get("foo")!.hash, afterFoo.get("foo")!.hash);
  assert.ok(store.isResolvable(barHash!));
});

test("parked conflict is resolvable after the fact", () => {
  const store = new Store();
  const base: Namespace = new Map();
  const tx1 = submit(store, base, "agent-1", "x", "def signup -> Int = 1");
  const tx2 = submit(store, base, "agent-2", "y", "def signup -> Int = 2");
  const r = merge(base, store, [tx1, tx2]);
  const winner = r.conflicts[0].contenders.find((c) => c.by === "agent-2")!;
  const resolved = resolveConflict(r.namespace, r.conflicts[0], winner.hash);
  assert.equal(resolved.get("signup")!.hash, winner.hash);
});
