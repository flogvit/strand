import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/core/store.ts";
import { compileProgram, evalQuery } from "../src/pipeline.ts";
import { valueToString } from "../src/core/eval.ts";
import { emitModule } from "../src/backend/emit_ts.ts";
import type { Namespace } from "../src/model.ts";
import type { Hash } from "../src/core/term.ts";

function build(src: string): { ns: Namespace; store: Store; names: Map<string, Hash> } {
  const store = new Store();
  const names = new Map<string, Hash>();
  const ns: Namespace = new Map();
  for (const b of compileProgram(src, store, names)) {
    names.set(b.name, b.hash);
    ns.set(b.name, { hash: b.hash, intent: "", by: "test" });
  }
  return { ns, store, names };
}

function runTranspiled(ns: Namespace, store: Store, expr: string): string {
  const dir = mkdtempSync(join(tmpdir(), "strand-rec-"));
  const file = join(dir, "m.ts");
  writeFileSync(file, emitModule(ns, store) + `\nconsole.log(String(${expr}));\n`);
  return execFileSync("npx", ["tsx", file], { encoding: "utf8" }).trim();
}

const FAC = "def fac (n: Int) -> Int = if n < 1 then 1 else n * fac (n - 1)";
const FIB = "def fib (n: Int) -> Int = if n < 2 then n else fib (n - 1) + fib (n - 2)";

test("recursion: factorial evaluates (interpreter)", () => {
  const { store, names } = build(FAC);
  assert.equal(valueToString(evalQuery("fac 5", store, names)), "120");
});

test("recursion: fibonacci evaluates (interpreter)", () => {
  const { store, names } = build(FIB);
  assert.equal(valueToString(evalQuery("fib 10", store, names)), "55");
});

test("recursion: factorial transpiles to TS and runs to the same value", () => {
  const { ns, store } = build(FAC);
  assert.equal(runTranspiled(ns, store, "fac(5)"), "120");
});

test("recursion: fibonacci transpiles to TS and runs to the same value", () => {
  const { ns, store } = build(FIB);
  assert.equal(runTranspiled(ns, store, "fib(10)"), "55");
});

test("recursion expresses unbounded computation (sum 1..n)", () => {
  const { store, names } = build("def sum (n: Int) -> Int = if n < 1 then 0 else n + sum (n - 1)");
  assert.equal(valueToString(evalQuery("sum 100", store, names)), "5050");
});

test("a recursive definition still content-addresses well-foundedly", () => {
  // building it at all proves the hash did not depend on itself
  const { names } = build(FAC);
  assert.ok(names.has("fac"));
});
