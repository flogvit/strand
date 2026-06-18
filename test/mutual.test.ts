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
import type { Namespace } from "../src/model.ts";

function build(src: string): { store: Store; ns: Namespace; names: Map<string, string>; registry: ReturnType<typeof registryOf> } {
  const store = new Store();
  const ns: Namespace = new Map();
  for (const b of compileProgram(src, store, new Map(), [])) ns.set(b.name, { hash: b.hash, intent: "", by: "t" });
  return { store, ns, names: valueNamesOf(ns, store), registry: registryOf(ns, store) };
}

function runT(ns: Namespace, store: Store, expr: string): string {
  const dir = mkdtempSync(join(tmpdir(), "strand-mut-"));
  const file = join(dir, "m.ts");
  writeFileSync(file, emitModule(ns, store) + `\nconsole.log(String(${expr}));\n`);
  return execFileSync("npx", ["tsx", file], { encoding: "utf8" }).trim();
}

const EVENODD =
  "def even (n: Int) -> Bool = if n == 0 then true else odd (n - 1)\n" +
  "def odd (n: Int) -> Bool = if n == 0 then false else even (n - 1)";

test("mutual recursion evaluates (interpreter)", () => {
  const { store, names, registry } = build(EVENODD);
  assert.equal(valueToString(evalQuery("even 10", store, names, registry)), "true");
  assert.equal(valueToString(evalQuery("odd 7", store, names, registry)), "true");
  assert.equal(valueToString(evalQuery("even 7", store, names, registry)), "false");
});

test("mutual recursion transpiles to TS and runs identically", () => {
  const { ns, store } = build(EVENODD);
  assert.equal(runT(ns, store, "even(10)"), "true");
  assert.equal(runT(ns, store, "odd(7)"), "true");
});

test("a mutually-recursive group compiles and is content-addressed", () => {
  const { names } = build(EVENODD);
  assert.ok(names.has("even") && names.has("odd"));
});

test("forward references to a later definition work", () => {
  const { store, names, registry } = build("def a -> Int = b 5\ndef b (n: Int) -> Int = n + 1");
  assert.equal(valueToString(evalQuery("a", store, names, registry)), "6");
});

test("three-way mutual recursion", () => {
  const src =
    "def f (n: Int) -> Int = if n < 1 then 0 else g (n - 1)\n" +
    "def g (n: Int) -> Int = if n < 1 then 1 else h (n - 1)\n" +
    "def h (n: Int) -> Int = if n < 1 then 2 else f (n - 1)";
  const { store, names, registry } = build(src);
  assert.equal(valueToString(evalQuery("f 9", store, names, registry)), "0");
  assert.equal(valueToString(evalQuery("f 7", store, names, registry)), "1");
  assert.equal(valueToString(evalQuery("h 7", store, names, registry)), "0");
});
