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
  const dir = mkdtempSync(join(tmpdir(), "strand-pat-"));
  const file = join(dir, "m.ts");
  writeFileSync(file, emitModule(ns, store) + `\nconsole.log(String(${expr}));\n`);
  return execFileSync("npx", ["tsx", file], { encoding: "utf8" }).trim();
}

const COLOR = "data Color = Red | Green | Blue\n";

test("a non-exhaustive match is a compile-time type error", () => {
  assert.throws(
    () => build(COLOR + "def f (c: Color) -> Int = match c { Red -> 0 | Green -> 1 }"),
    StrandTypeError,
  );
});

test("covering all constructors type-checks and runs", () => {
  const { store, names, registry } = build(COLOR + "def f (c: Color) -> Int = match c { Red -> 0 | Green -> 1 | Blue -> 2 }");
  assert.equal(valueToString(evalQuery("f Green", store, names, registry)), "1");
});

test("a wildcard makes a match exhaustive", () => {
  const { store, names, registry } = build(COLOR + "def f (c: Color) -> Int = match c { Red -> 0 | _ -> 9 }");
  assert.equal(valueToString(evalQuery("f Red", store, names, registry)), "0");
  assert.equal(valueToString(evalQuery("f Blue", store, names, registry)), "9");
});

test("wildcard transpiles to TS and runs identically", () => {
  const { ns, store } = build(COLOR + "def f (c: Color) -> Int = match c { Red -> 0 | _ -> 9 }");
  assert.equal(runT(ns, store, "f(Red)"), "0");
  assert.equal(runT(ns, store, "f(Blue)"), "9");
});
