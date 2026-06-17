import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.ts";
import { hashOf } from "../src/hash.ts";
import { merge, resolveConflict } from "../src/merge.ts";
import type { DefinitionContent, Namespace, Transaction } from "../src/model.ts";

const def = (deps: string[], body: string): DefinitionContent => ({ deps, body });
const H = hashOf;
const emptyBase = (): Namespace => new Map();

test("independent definitions auto-merge with zero conflicts", () => {
  const store = new Store();
  const a = def([], "A");
  const b = def([], "B");
  const tx1: Transaction = { by: "x", puts: [a], binds: [{ name: "a", hash: H(a), intent: "" }] };
  const tx2: Transaction = { by: "y", puts: [b], binds: [{ name: "b", hash: H(b), intent: "" }] };
  const r = merge(emptyBase(), store, [tx1, tx2]);
  assert.deepEqual(r.applied.sort(), ["a", "b"]);
  assert.equal(r.conflicts.length, 0);
});

test("same name + different content = exactly one parked conflict; other names still apply", () => {
  const store = new Store();
  const s1 = def([], "signup v1");
  const s2 = def([], "signup v2");
  const other = def([], "login");
  const tx1: Transaction = {
    by: "x",
    puts: [s1, other],
    binds: [
      { name: "signup", hash: H(s1), intent: "" },
      { name: "login", hash: H(other), intent: "" },
    ],
  };
  const tx2: Transaction = { by: "y", puts: [s2], binds: [{ name: "signup", hash: H(s2), intent: "" }] };
  const r = merge(emptyBase(), store, [tx1, tx2]);
  assert.equal(r.conflicts.length, 1);
  assert.equal(r.conflicts[0].name, "signup");
  assert.ok(r.applied.includes("login")); // independent name unaffected by the conflict
});

test("convergent edits (same name, same content) are not a conflict", () => {
  const store = new Store();
  const s = def([], "same");
  const tx1: Transaction = { by: "x", puts: [s], binds: [{ name: "signup", hash: H(s), intent: "" }] };
  const tx2: Transaction = { by: "y", puts: [s], binds: [{ name: "signup", hash: H(s), intent: "" }] };
  const r = merge(emptyBase(), store, [tx1, tx2]);
  assert.equal(r.conflicts.length, 0);
  assert.deepEqual(r.applied, ["signup"]);
});

test("bind to unresolvable content is rejected, not merged, and doesn't poison others", () => {
  const store = new Store();
  const good = def([], "good");
  const dangling = def(["#deadbeef"], "bad"); // references a hash never put
  const tx: Transaction = {
    by: "x",
    puts: [good, dangling],
    binds: [
      { name: "good", hash: H(good), intent: "" },
      { name: "bad", hash: H(dangling), intent: "" },
    ],
  };
  const r = merge(emptyBase(), store, [tx]);
  assert.ok(r.applied.includes("good"));
  assert.equal(r.namespace.has("bad"), false);
  assert.equal(r.rejected.length, 1);
  assert.equal(r.rejected[0].name, "bad");
});

test("a pinned hash survives name churn (reference by identity)", () => {
  const store = new Store();
  const fooV1 = def([], "foo v1");
  store.put(fooV1);
  const base: Namespace = new Map([["foo", { hash: H(fooV1), intent: "", by: "seed" }]]);
  // agent Y pins foo's ORIGINAL hash inside its own definition
  const usesFoo = def([H(fooV1)], "bar -> foo v1");
  // agent X rebinds the NAME foo to new content
  const fooV2 = def([], "foo v2");
  const txX: Transaction = { by: "x", puts: [fooV2], binds: [{ name: "foo", hash: H(fooV2), intent: "" }] };
  const txY: Transaction = { by: "y", puts: [usesFoo], binds: [{ name: "bar", hash: H(usesFoo), intent: "" }] };
  const r = merge(base, store, [txX, txY]);
  // the NAME foo now points at v2...
  assert.equal(r.namespace.get("foo")!.hash, H(fooV2));
  // ...but bar still resolves, because it pinned v1's hash, which is immutable
  assert.ok(store.isResolvable(H(usesFoo)));
  assert.ok(store.get(H(usesFoo))!.deps.includes(H(fooV1)));
});

test("parked conflict is resolvable after the fact", () => {
  const store = new Store();
  const s1 = def([], "v1");
  const s2 = def([], "v2");
  const tx1: Transaction = { by: "x", puts: [s1], binds: [{ name: "signup", hash: H(s1), intent: "x?" }] };
  const tx2: Transaction = { by: "y", puts: [s2], binds: [{ name: "signup", hash: H(s2), intent: "y?" }] };
  const r = merge(emptyBase(), store, [tx1, tx2]);
  const resolved = resolveConflict(r.namespace, r.conflicts[0], H(s2));
  assert.equal(resolved.get("signup")!.hash, H(s2));
});
