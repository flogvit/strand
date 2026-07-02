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

// Text primitives (#35): textLength, charAt, substring, intToText — total
// functions (out-of-range reads are "", never a crash), identical in both
// engines. These are what let a swarm write escapeHtml/textJoin instead of
// pinning string-safety as a mere convention.

function build(src: string): { store: Store; ns: Namespace; names: Map<string, string>; registry: ReturnType<typeof registryOf> } {
  const store = new Store();
  const ns: Namespace = new Map();
  for (const b of compileProgram(src, store, new Map(), [])) ns.set(b.name, { hash: b.hash, intent: "", by: "t" });
  return { store, ns, names: valueNamesOf(ns, store), registry: registryOf(ns, store) };
}

function runT(ns: Namespace, store: Store, expr: string): string {
  const dir = mkdtempSync(join(tmpdir(), "strand-textprims-"));
  const file = join(dir, "m.ts");
  writeFileSync(file, emitModule(ns, store) + `\nconsole.log(String(${expr}));\n`);
  return execFileSync("npx", ["tsx", file], { encoding: "utf8" }).trim();
}

/** Assert interpreter and transpiled TS agree on the expression's value. */
function both(src: string, expr: string, tsExpr: string, expected: string): void {
  const { store, ns, names, registry } = build(src);
  assert.equal(valueToString(evalQuery(expr, store, names, registry)), expected, `interpreter: ${expr}`);
  assert.equal(runT(ns, store, tsExpr), expected.replaceAll('"', ""), `transpiled: ${tsExpr}`);
}

test("textLength counts characters", () => {
  both(`def n -> Int = textLength "heia"`, "n", "n()", "4");
  both(`def z -> Int = textLength ""`, "z", "z()", "0");
});

test("charAt is total: a single character in range, empty out of range", () => {
  both(`def a -> Text = charAt 0 "abc"`, "a", "a()", '"a"');
  both(`def c -> Text = charAt 2 "abc"`, "c", "c()", '"c"');
  both(`def past -> Text = charAt 3 "abc"`, "past", "past()", '""');
  both(`def neg -> Text = charAt (0 - 1) "abc"`, "neg", "neg()", '""');
});

test("substring takes [start, end) with clamping, never crashes", () => {
  both(`def mid -> Text = substring 1 3 "abcd"`, "mid", "mid()", '"bc"');
  both(`def all -> Text = substring 0 99 "ab"`, "all", "all()", '"ab"');
  both(`def rev -> Text = substring 3 1 "abcd"`, "rev", "rev()", '""');
  both(`def negs -> Text = substring (0 - 2) 1 "abcd"`, "negs", "negs()", '"a"');
});

test("intToText renders base-10 integers", () => {
  both(`def s -> Text = intToText 42`, "s", "s()", '"42"');
  both(`def m -> Text = intToText (0 - 7)`, "m", "m()", '"-7"');
  both(`def z -> Text = intToText 0`, "z", "z()", '"0"');
});

test("the primitives compose in ordinary definitions through the gate", () => {
  const src = [
    `def escapeAmp (t: Text) -> Text = escapeFrom t 0`,
    `def escapeFrom (t: Text) (i: Int) -> Text =`,
    `  if i >= textLength t then ""`,
    `  else (if charAt i t == "&" then "&amp;" else charAt i t) ++ escapeFrom t (i + 1)`,
  ].join("\n");
  both(src, `escapeAmp "a&b"`, `escapeAmp("a&b")`, '"a&amp;b"');
});

test("a wrong argument type is rejected by the checker", () => {
  assert.throws(() => build(`def bad -> Int = textLength 7`), /Text|unify/i);
});
