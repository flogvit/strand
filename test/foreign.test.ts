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
  const dir = mkdtempSync(join(tmpdir(), "strand-fgn-"));
  const file = join(dir, "m.ts");
  writeFileSync(file, emitModule(ns, store) + `\nconsole.log(String(${expr}));\n`);
  return execFileSync("npx", ["tsx", file], { encoding: "utf8" }).trim();
}

test("a foreign function is callable from Strand (interpreter)", () => {
  const src =
    'foreign sqrtFloor (n: Int) -> Int = "Math.floor(Math.sqrt(n))"\n' +
    "def demo (n: Int) -> Int = sqrtFloor n + 1";
  const { store, names, registry } = build(src);
  assert.equal(valueToString(evalQuery("sqrtFloor 17", store, names, registry)), "4");
  assert.equal(valueToString(evalQuery("demo 17", store, names, registry)), "5");
});

test("a zero-parameter foreign value", () => {
  const { store, names, registry } = build('foreign answer -> Int = "6 * 7"');
  assert.equal(valueToString(evalQuery("answer", store, names, registry)), "42");
});

test("a foreign over Text", () => {
  const { store, names, registry } = build('foreign upper (s: Text) -> Text = "s.toUpperCase()"');
  assert.equal(valueToString(evalQuery('upper "hi"', store, names, registry)), '"HI"');
});

test("foreign transpiles to TS and runs identically", () => {
  const { ns, store } = build('foreign sqrtFloor (n: Int) -> Int = "Math.floor(Math.sqrt(n))"');
  assert.equal(runT(ns, store, "sqrtFloor(17)"), "4");
});
