import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/core/store.ts";
import { compileProgram } from "../src/pipeline.ts";
import { typecheckNamespace } from "../src/core/check.ts";
import type { Namespace } from "../src/model.ts";

function bindInto(ns: Namespace, store: Store, by: string, src: string): void {
  for (const b of compileProgram(src, store, new Map(), dataDecls(ns, store))) {
    ns.set(b.name, { hash: b.hash, intent: "", by });
  }
}

function dataDecls(ns: Namespace, store: Store) {
  const out = [];
  for (const b of ns.values()) {
    const d = store.dataOf(b.hash);
    if (d) out.push(d);
  }
  return out;
}

test("a freshly merged namespace is green", () => {
  const store = new Store();
  const ns: Namespace = new Map();
  bindInto(ns, store, "a", "data Color = Red | Green\ndef f (c: Color) -> Int = match c { Red -> 0 | Green -> 1 }");
  assert.deepEqual(typecheckNamespace(ns, store), []);
});

test("content-addressed types: a green definition survives a type-name rebind", () => {
  const store = new Store();
  const ns: Namespace = new Map();
  bindInto(ns, store, "a", "data Color = Red | Green\ndef f (c: Color) -> Int = match c { Red -> 0 | Green -> 1 }");
  assert.deepEqual(typecheckNamespace(ns, store), []); // green

  // agent B rebinds the type name `Color` to an incompatible declaration
  for (const b of compileProgram("data Color = Blue", store, new Map(), [])) {
    ns.set(b.name, { hash: b.hash, intent: "", by: "b" });
  }

  // f pinned the original Color (by content hash), so it stays green — the
  // rebind of the *name* Color does not break it. Types are by identity.
  assert.deepEqual(typecheckNamespace(ns, store), []);
});
