import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/core/store.ts";
import { compileProgram, evalQuery, registryOf, valueNamesOf } from "../src/pipeline.ts";
import { valueToString } from "../src/core/eval.ts";
import { emitModule } from "../src/backend/emit_ts.ts";
import type { Namespace } from "../src/model.ts";

const PRELUDE = readFileSync(join(process.cwd(), "lib", "prelude.strand"), "utf8");
const PROGRAM = readFileSync(join(process.cwd(), "examples", "program.strand"), "utf8");
const SRC = PRELUDE + "\n" + PROGRAM;

function build(src: string): { store: Store; ns: Namespace; names: Map<string, string>; registry: ReturnType<typeof registryOf> } {
  const store = new Store();
  const ns: Namespace = new Map();
  for (const b of compileProgram(src, store, new Map(), [])) ns.set(b.name, { hash: b.hash, intent: "", by: "t" });
  return { store, ns, names: valueNamesOf(ns, store), registry: registryOf(ns, store) };
}

function runTranspiled(ns: Namespace, store: Store, expr: string): string {
  const dir = mkdtempSync(join(tmpdir(), "strand-prog-"));
  const file = join(dir, "m.ts");
  writeFileSync(file, emitModule(ns, store) + `\nconsole.log(String(${expr}));\n`);
  return execFileSync("npx", ["tsx", file], { encoding: "utf8" }).trim();
}

test("a real Strand program (prelude + quicksort + expr evaluator) runs on the interpreter", () => {
  const { store, names, registry } = build(SRC);
  assert.equal(valueToString(evalQuery("sum (range 5)", store, names, registry)), "15");
  assert.equal(
    valueToString(evalQuery("qsort (Cons 3 (Cons 1 (Cons 2 (Cons 1 Nil))))", store, names, registry)),
    "Cons 1 (Cons 1 (Cons 2 (Cons 3 Nil)))",
  );
  assert.equal(
    valueToString(evalQuery("evalExpr (Add (Num 2) (Mul (Num 3) (Num 4)))", store, names, registry)),
    "14",
  );
});

test("the same real program transpiles to TypeScript and runs identically", () => {
  const { ns, store } = build(SRC);
  assert.equal(runTranspiled(ns, store, "sum(range(5))"), "15");
  assert.equal(runTranspiled(ns, store, "evalExpr(Add(Num(2))(Mul(Num(3))(Num(4))))"), "14");
});
