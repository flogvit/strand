import { test } from "node:test";
import assert from "node:assert/strict";
import { parseExpr, parseProgram } from "../src/syntax/parser.ts";
import { tyToString } from "../src/core/types.ts";

test("parses a def with params, signature and body", () => {
  const [d] = parseProgram("def add (a: Int) (b: Int) -> Int = a + b");
  assert.equal(d.name, "add");
  assert.equal(d.params.length, 2);
  assert.equal(tyToString(d.params[0].ty), "Int");
  assert.equal(tyToString(d.ret), "Int");
  assert.equal(d.body.tag, "BinOp");
});

test("application binds tighter than arithmetic", () => {
  // f x + g y  ==  (f x) + (g y)
  const e = parseExpr("f x + g y");
  assert.equal(e.tag, "BinOp");
  if (e.tag !== "BinOp") return;
  assert.equal(e.left.tag, "App");
  assert.equal(e.right.tag, "App");
});

test("application is left-associative", () => {
  const e = parseExpr("add n n"); // (add n) n
  assert.equal(e.tag, "App");
  if (e.tag !== "App") return;
  assert.equal(e.fn.tag, "App");
  assert.equal(e.arg.tag, "Name");
});

test("parses if/then/else without swallowing the branches", () => {
  const e = parseExpr("if x < y then x else y");
  assert.equal(e.tag, "If");
  if (e.tag !== "If") return;
  assert.equal(e.cond.tag, "BinOp");
  assert.equal(e.then.tag, "Name");
  assert.equal(e.else.tag, "Name");
});

test("parses higher-order function types", () => {
  const [d] = parseProgram("def twice (f: Int -> Int) (n: Int) -> Int = f (f n)");
  assert.equal(tyToString(d.params[0].ty), "Int -> Int");
});

test("parses multiple defs and line comments", () => {
  const defs = parseProgram("# greeting helpers\ndef a -> Int = 1\ndef b -> Int = a + 1");
  assert.equal(defs.length, 2);
  assert.deepEqual(defs.map((d) => d.name), ["a", "b"]);
});
