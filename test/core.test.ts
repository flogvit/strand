import { test } from "node:test";
import assert from "node:assert/strict";
import { hashOf } from "../src/core/hash.ts";
import { Store } from "../src/core/store.ts";
import type { CoreDef } from "../src/core/term.ts";
import { tInt, tFun } from "../src/core/types.ts";

// def add (a: Int) (b: Int) -> Int = a + b
const add = (p1: string, p2: string): CoreDef => ({
  params: [
    { name: p1, ty: tInt },
    { name: p2, ty: tInt },
  ],
  ret: tInt,
  body: { tag: "BinOp", op: "+", left: { tag: "Var", name: p1 }, right: { tag: "Var", name: p2 } },
});

test("structurally identical defs hash the same regardless of parameter names", () => {
  assert.equal(hashOf(add("a", "b")), hashOf(add("x", "y")));
});

test("different bodies hash differently", () => {
  const sub: CoreDef = {
    params: [
      { name: "a", ty: tInt },
      { name: "b", ty: tInt },
    ],
    ret: tInt,
    body: { tag: "BinOp", op: "-", left: { tag: "Var", name: "a" }, right: { tag: "Var", name: "b" } },
  };
  assert.notEqual(hashOf(add("a", "b")), hashOf(sub));
});

test("store put is idempotent and tracks resolvability", () => {
  const store = new Store();
  const h1 = store.put(add("a", "b"), tFun(tInt, tFun(tInt, tInt)));
  const h2 = store.put(add("x", "y"), tFun(tInt, tFun(tInt, tInt)));
  assert.equal(h1, h2); // same content, one object
  assert.ok(store.isResolvable(h1));
  assert.equal(store.isResolvable("#nope"), false);
});

test("store round-trips through JSON", () => {
  const store = new Store();
  const h = store.put(add("a", "b"), tFun(tInt, tFun(tInt, tInt)));
  const revived = Store.fromJSON(JSON.parse(JSON.stringify(store.toJSON())));
  assert.ok(revived.has(h));
  assert.deepEqual(revived.get(h)!.def, store.get(h)!.def);
});
