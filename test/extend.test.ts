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
import { StrandTypeError } from "../src/errors.ts";
import type { Namespace } from "../src/model.ts";

function build(src: string): { store: Store; ns: Namespace; names: Map<string, string>; registry: ReturnType<typeof registryOf> } {
  const store = new Store();
  const ns: Namespace = new Map();
  for (const b of compileProgram(src, store, new Map(), [])) ns.set(b.name, { hash: b.hash, intent: "", by: "t" });
  return { store, ns, names: valueNamesOf(ns, store), registry: registryOf(ns, store) };
}

function runT(ns: Namespace, store: Store, expr: string): string {
  const dir = mkdtempSync(join(tmpdir(), "strand-ext-"));
  const file = join(dir, "m.ts");
  writeFileSync(file, emitModule(ns, store) + `\nconsole.log(String(${expr}));\n`);
  return execFileSync("npx", ["tsx", file], { encoding: "utf8" }).trim();
}

test("let-bindings introduce a local name", () => {
  const { store, names, registry } = build("def f (n: Int) -> Int = let d = n + 1 in d * d");
  assert.equal(valueToString(evalQuery("f 4", store, names, registry)), "25");
});

test("lambdas work as higher-order arguments", () => {
  const { store, names, registry } = build("def apply (f: Int -> Int) (n: Int) -> Int = f n");
  assert.equal(valueToString(evalQuery("apply (fn (x: Int) -> x * x) 6", store, names, registry)), "36");
});

test("a lambda captures its enclosing environment (closure)", () => {
  const { store, names, registry } = build("def adder (n: Int) -> Int -> Int = fn (x: Int) -> x + n");
  assert.equal(valueToString(evalQuery("adder 10 5", store, names, registry)), "15");
});

test("the new operators behave correctly", () => {
  const src = "def t -> Bool = (7 / 2 == 3) && (7 % 2 == 1) && (3 <= 3) && (2 >= 5 || true)";
  const { store, names, registry } = build(src);
  assert.equal(valueToString(evalQuery("t", store, names, registry)), "true");
});

test("let, lambda and operators transpile to TS and run identically", () => {
  const { ns, store } = build(
    "def adder (n: Int) -> Int -> Int = fn (x: Int) -> x + n\ndef g (n: Int) -> Int = let d = n / 2 in d + 1",
  );
  assert.equal(runT(ns, store, "adder(10)(5)"), "15");
  assert.equal(runT(ns, store, "g(9)"), "5");
});

test("the type checker still rejects ill-typed uses of the new forms", () => {
  assert.throws(() => build("def bad -> Int = let x = true in x + 1"), StrandTypeError);
  assert.throws(() => build("def bad -> Bool = 1 && true"), StrandTypeError);
});
