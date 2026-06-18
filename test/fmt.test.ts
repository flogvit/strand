import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseProgram } from "../src/syntax/parser.ts";
import { printProgram } from "../src/syntax/print.ts";

const fmt = (src: string): string => printProgram(parseProgram(src));

test("formatting is idempotent", () => {
  const messy = "def   f (a:Int)(b:Int)->Int=a+b*2\ndata List a=Nil|Cons a (List a)";
  const once = fmt(messy);
  assert.equal(fmt(once), once);
});

test("formatted output re-parses and stays stable", () => {
  const src = "def g (n: Int) -> Int = if n < 1 then 0 else g (n - 1)";
  const out = fmt(src);
  assert.equal(parseProgram(out).length, 1);
  assert.equal(fmt(out), out);
});

test("formats the prelude idempotently", () => {
  const prelude = readFileSync(join(process.cwd(), "lib", "prelude.strand"), "utf8");
  const out = fmt(prelude);
  assert.equal(fmt(out), out);
});
