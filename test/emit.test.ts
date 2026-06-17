import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/core/store.ts";
import { compileProgram } from "../src/pipeline.ts";
import { emitModule } from "../src/backend/emit_ts.ts";
import type { Namespace } from "../src/model.ts";

function build(src: string): { ns: Namespace; store: Store } {
  const store = new Store();
  const ns: Namespace = new Map();
  const binds = compileProgram(src, store, new Map());
  for (const b of binds) ns.set(b.name, { hash: b.hash, intent: "", by: "test" });
  return { ns, store };
}

test("emits a const per definition", () => {
  const { ns, store } = build("def add (a: Int) (b: Int) -> Int = a + b\ndef double (n: Int) -> Int = add n n");
  const ts = emitModule(ns, store);
  assert.match(ts, /export const add = \(a: number\) => \(b: number\): number => \(a \+ b\);/);
  assert.match(ts, /export const double = \(n: number\): number => add\(n\)\(n\);/);
});

test("emits definitions in dependency order (dependency before user)", () => {
  const { ns, store } = build("def add (a: Int) (b: Int) -> Int = a + b\ndef double (n: Int) -> Int = add n n");
  const ts = emitModule(ns, store);
  assert.ok(ts.indexOf("const add") < ts.indexOf("const double"));
});

test("maps == to === and if to a ternary", () => {
  const { ns, store } = build("def eq (a: Int) (b: Int) -> Bool = a == b\ndef pick (c: Bool) -> Int = if c then 1 else 0");
  const ts = emitModule(ns, store);
  assert.match(ts, /a === b/);
  assert.match(ts, /\? 1 : 0/);
});
