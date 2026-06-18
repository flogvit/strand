import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/core/store.ts";
import { compileProgram, evalQuery, registryOf, valueNamesOf } from "../src/pipeline.ts";
import { valueToString } from "../src/core/eval.ts";
import { emitModule } from "../src/backend/emit_ts.ts";
import { tyToString } from "../src/core/types.ts";
import { StrandTypeError } from "../src/errors.ts";
import type { Namespace } from "../src/model.ts";

function build(src: string): { store: Store; ns: Namespace; names: Map<string, string>; registry: ReturnType<typeof registryOf> } {
  const store = new Store();
  const ns: Namespace = new Map();
  for (const b of compileProgram(src, store, new Map(), [])) ns.set(b.name, { hash: b.hash, intent: "", by: "t" });
  return { store, ns, names: valueNamesOf(ns, store), registry: registryOf(ns, store) };
}

function runT(ns: Namespace, store: Store, expr: string): string {
  const dir = mkdtempSync(join(tmpdir(), "strand-inf-"));
  const file = join(dir, "m.ts");
  writeFileSync(file, emitModule(ns, store) + `\nconsole.log(String(${expr}));\n`);
  return execFileSync("npx", ["tsx", file], { encoding: "utf8" }).trim();
}

test("infers a monomorphic function with no annotations", () => {
  const { store, ns, names, registry } = build("def add a b = a + b");
  assert.equal(tyToString(store.typeOf(ns.get("add")!.hash)!), "Int -> Int -> Int");
  assert.equal(valueToString(evalQuery("add 3 4", store, names, registry)), "7");
});

test("infers a polymorphic identity, usable at multiple types", () => {
  const { store, ns, names, registry } = build("def id x = x\ndef a -> Int = id 1\ndef b -> Bool = id true");
  assert.equal(tyToString(store.typeOf(ns.get("id")!.hash)!), "t0 -> t0");
  assert.equal(valueToString(evalQuery("a", store, names, registry)), "1");
  assert.equal(valueToString(evalQuery("b", store, names, registry)), "true");
});

test("partial annotations are allowed", () => {
  const { store, names, registry } = build("def f (n: Int) x = n + x");
  assert.equal(valueToString(evalQuery("f 3 4", store, names, registry)), "7");
});

test("zero-argument inference", () => {
  const { store, names, registry } = build("def answer = 6 * 7");
  assert.equal(valueToString(evalQuery("answer", store, names, registry)), "42");
});

test("self-recursion works without annotations", () => {
  const { store, names, registry } = build("def countdown n = if n < 1 then 0 else countdown (n - 1)");
  assert.equal(valueToString(evalQuery("countdown 5", store, names, registry)), "0");
});

test("inferred definitions transpile and run identically", () => {
  const { ns, store } = build("def add a b = a + b\ndef twice f x = f (f x)\ndef inc n = n + 1");
  assert.equal(runT(ns, store, "add(3)(4)"), "7");
  assert.equal(runT(ns, store, "twice(inc)(5)"), "7");
});

test("inference still catches type errors", () => {
  assert.throws(() => build("def bad x = x + true"), StrandTypeError);
});
