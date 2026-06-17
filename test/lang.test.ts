import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/core/store.ts";
import { compileProgram, evalQuery } from "../src/pipeline.ts";
import { valueToString } from "../src/core/eval.ts";
import { StrandResolveError, StrandTypeError } from "../src/errors.ts";
import type { Hash } from "../src/core/term.ts";

function fresh(): { store: Store; names: Map<string, Hash> } {
  return { store: new Store(), names: new Map() };
}

test("end-to-end: parse -> resolve -> typecheck -> eval", () => {
  const { store, names } = fresh();
  const binds = compileProgram(
    "def add (a: Int) (b: Int) -> Int = a + b\ndef double (n: Int) -> Int = add n n",
    store,
    names,
  );
  for (const b of binds) names.set(b.name, b.hash);
  assert.equal(valueToString(evalQuery("double 21", store, names)), "42");
});

test("higher-order functions evaluate correctly", () => {
  const { store, names } = fresh();
  const binds = compileProgram(
    "def inc (n: Int) -> Int = n + 1\ndef twice (f: Int -> Int) (n: Int) -> Int = f (f n)",
    store,
    names,
  );
  for (const b of binds) names.set(b.name, b.hash);
  assert.equal(valueToString(evalQuery("twice inc 5", store, names)), "7");
});

test("if / comparison works", () => {
  const { store, names } = fresh();
  const binds = compileProgram("def max (a: Int) (b: Int) -> Int = if a < b then b else a", store, names);
  for (const b of binds) names.set(b.name, b.hash);
  assert.equal(valueToString(evalQuery("max 3 9", store, names)), "9");
  assert.equal(valueToString(evalQuery("max 12 4", store, names)), "12");
});

test("the type checker rejects ill-typed definitions (green-gate)", () => {
  const { store, names } = fresh();
  assert.throws(() => compileProgram("def bad -> Int = true", store, names), StrandTypeError);
});

test("the type checker rejects a type-mismatched application", () => {
  const { store, names } = fresh();
  assert.throws(
    () => compileProgram("def inc (n: Int) -> Int = n + 1\ndef oops -> Int = inc true", store, names),
    StrandTypeError,
  );
});

test("unknown names are a resolve error", () => {
  const { store, names } = fresh();
  assert.throws(() => compileProgram("def x -> Int = nope + 1", store, names), StrandResolveError);
});
