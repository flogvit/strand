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
import { StrandTypeError } from "../src/errors.ts";

function build(src: string): { store: Store; ns: Namespace; names: Map<string, string>; registry: ReturnType<typeof registryOf> } {
  const store = new Store();
  const ns: Namespace = new Map();
  for (const b of compileProgram(src, store, new Map(), [])) ns.set(b.name, { hash: b.hash, intent: "", by: "t" });
  return { store, ns, names: valueNamesOf(ns, store), registry: registryOf(ns, store) };
}

function runTranspiled(ns: Namespace, store: Store, expr: string): string {
  const dir = mkdtempSync(join(tmpdir(), "strand-data-"));
  const file = join(dir, "m.ts");
  writeFileSync(file, emitModule(ns, store) + `\nconsole.log(String(${expr}));\n`);
  return execFileSync("npx", ["tsx", file], { encoding: "utf8" }).trim();
}

const LIST = `
data List a = Nil | Cons a (List a)
def length (xs: List a) -> Int = match xs { Nil -> 0 | Cons h t -> 1 + length t }
def sum (xs: List Int) -> Int = match xs { Nil -> 0 | Cons h t -> h + sum t }
def map (f: a -> b) (xs: List a) -> List b = match xs { Nil -> Nil | Cons h t -> Cons (f h) (map f t) }
def inc (n: Int) -> Int = n + 1
`;

test("generic list: length and sum (interpreter)", () => {
  const { store, names, registry } = build(LIST);
  assert.equal(valueToString(evalQuery("length (Cons 1 (Cons 2 (Cons 3 Nil)))", store, names, registry)), "3");
  assert.equal(valueToString(evalQuery("sum (Cons 10 (Cons 20 Nil))", store, names, registry)), "30");
});

test("generic map over a list (interpreter)", () => {
  const { store, names, registry } = build(LIST);
  assert.equal(valueToString(evalQuery("map inc (Cons 1 (Cons 2 Nil))", store, names, registry)), "Cons 2 (Cons 3 Nil)");
});

test("list program transpiles to TS and runs to the same value", () => {
  const { ns, store } = build(LIST);
  assert.equal(runTranspiled(ns, store, "length(Cons(1)(Cons(2)(Cons(3)(Nil))))"), "3");
  assert.equal(runTranspiled(ns, store, "sum(Cons(10)(Cons(20)(Nil)))"), "30");
});

test("Option with pattern matching (interpreter and transpiled)", () => {
  const src = "data Option a = None | Some a\ndef getOr (d: a) (o: Option a) -> a = match o { None -> d | Some x -> x }";
  const { store, ns, names, registry } = build(src);
  assert.equal(valueToString(evalQuery("getOr 0 (Some 5)", store, names, registry)), "5");
  assert.equal(valueToString(evalQuery("getOr 0 None", store, names, registry)), "0");
  assert.equal(runTranspiled(ns, store, "getOr(0)(Some(5))"), "5");
});

test("text concatenation (interpreter and transpiled)", () => {
  const src = 'def greet (name: Text) -> Text = "Hello, " ++ name';
  const { store, ns, names, registry } = build(src);
  assert.equal(valueToString(evalQuery('greet "World"', store, names, registry)), '"Hello, World"');
  assert.equal(runTranspiled(ns, store, 'greet("World")'), "Hello, World");
});

test("parametricity is enforced: a value of type 'a' cannot be returned as Int", () => {
  assert.throws(
    () => build("data Box a = Box a\ndef bad (b: Box a) -> Int = match b { Box x -> x }"),
    StrandTypeError,
  );
});

test("type mismatch on a constructor argument is rejected", () => {
  assert.throws(
    () => build("data List a = Nil | Cons a (List a)\ndef bad -> Int = Cons 1 2"),
    StrandTypeError,
  );
});
