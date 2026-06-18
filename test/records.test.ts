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
  const dir = mkdtempSync(join(tmpdir(), "strand-rec-"));
  const file = join(dir, "m.ts");
  writeFileSync(file, emitModule(ns, store) + `\nconsole.log(String(${expr}));\n`);
  return execFileSync("npx", ["tsx", file], { encoding: "utf8" }).trim();
}

const SRC = "record Point { x: Int, y: Int }\ndef sumP (p: Point) -> Int = p.x + p.y";

test("record construction and field access (interpreter)", () => {
  const { store, names, registry } = build(SRC);
  assert.equal(valueToString(evalQuery("sumP (Point 3 4)", store, names, registry)), "7");
  assert.equal(valueToString(evalQuery("(Point 3 4).x", store, names, registry)), "3");
  assert.equal(valueToString(evalQuery("(Point 3 4).y", store, names, registry)), "4");
});

test("records transpile to TS and run identically", () => {
  const { ns, store } = build(SRC);
  assert.equal(runT(ns, store, "sumP(Point(3)(4))"), "7");
});

test("accessing a non-existent field is a type error", () => {
  assert.throws(() => build("record Point { x: Int, y: Int }\ndef bad (p: Point) -> Int = p.z"), StrandTypeError);
});

test("records compose with other features (let, lambdas)", () => {
  const src = SRC + "\ndef scale (k: Int) (p: Point) -> Point = let nx = k * p.x in Point nx (k * p.y)";
  const { store, names, registry } = build(src);
  assert.equal(valueToString(evalQuery("sumP (scale 2 (Point 3 4))", store, names, registry)), "14");
});
