import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/core/store.ts";
import { compileProgram, evalQuery, registryOf, valueNamesOf } from "../src/pipeline.ts";
import { valueToString } from "../src/core/eval.ts";
import { exportNamespace } from "../src/project.ts";
import { parseProgram } from "../src/syntax/parser.ts";
import type { Namespace } from "../src/model.ts";

function build(src: string): { store: Store; ns: Namespace; names: Map<string, string>; registry: ReturnType<typeof registryOf> } {
  const store = new Store();
  const ns: Namespace = new Map();
  for (const b of compileProgram(src, store, new Map(), [])) ns.set(b.name, { hash: b.hash, intent: "", by: "t" });
  return { store, ns, names: valueNamesOf(ns, store), registry: registryOf(ns, store) };
}

const SRC =
  "record Point { x: Int, y: Int }\n" +
  "data List a = Nil | Cons a (List a)\n" +
  "def len (xs: List a) -> Int = match xs { Nil -> 0 | Cons h t -> 1 + len t }\n" +
  "def sumP (p: Point) -> Int = p.x + p.y\n" +
  "def even (n: Int) -> Bool = if n == 0 then true else odd (n - 1)\n" +
  "def odd (n: Int) -> Bool = if n == 0 then false else even (n - 1)";

test("the namespace exports to Strand source that re-parses", () => {
  const { ns, store } = build(SRC);
  const exported = exportNamespace(ns, store);
  assert.ok(parseProgram(exported).length > 0);
  assert.match(exported, /record Point \{ x: Int, y: Int \}/);
});

test("export round-trips: re-compiling the export evaluates identically", () => {
  const first = build(SRC);
  const exported = exportNamespace(first.ns, first.store);
  const second = build(exported);
  for (const q of ["sumP (Point 3 4)", "len (Cons 1 (Cons 2 Nil))", "even 10", "odd 7"]) {
    assert.equal(
      valueToString(evalQuery(q, second.store, second.names, second.registry)),
      valueToString(evalQuery(q, first.store, first.names, first.registry)),
      `query ${q} should match across export`,
    );
  }
});
