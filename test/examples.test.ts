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

function buildExample(name: string): { store: Store; ns: Namespace; names: Map<string, string>; registry: ReturnType<typeof registryOf> } {
  const src = PRELUDE + "\n" + readFileSync(join(process.cwd(), "examples", `${name}.strand`), "utf8");
  const store = new Store();
  const ns: Namespace = new Map();
  for (const b of compileProgram(src, store, new Map(), [])) ns.set(b.name, { hash: b.hash, intent: "", by: "t" });
  return { store, ns, names: valueNamesOf(ns, store), registry: registryOf(ns, store) };
}

function runT(ns: Namespace, store: Store, expr: string): string {
  const dir = mkdtempSync(join(tmpdir(), "strand-ex-"));
  const file = join(dir, "m.ts");
  writeFileSync(file, emitModule(ns, store) + `\nconsole.log(String(${expr}));\n`);
  return execFileSync("npx", ["tsx", file], { encoding: "utf8" }).trim();
}

test("lists example", () => {
  const { store, names, registry } = buildExample("lists");
  assert.equal(valueToString(evalQuery("reverse (Cons 1 (Cons 2 (Cons 3 Nil)))", store, names, registry)), "Cons 3 (Cons 2 (Cons 1 Nil))");
  assert.equal(valueToString(evalQuery("take 2 (Cons 1 (Cons 2 (Cons 3 Nil)))", store, names, registry)), "Cons 1 (Cons 2 Nil)");
  assert.equal(valueToString(evalQuery("elem 2 (Cons 1 (Cons 2 Nil))", store, names, registry)), "true");
});

test("trees example (BST + tree sort, duplicates preserved)", () => {
  const { store, ns, names, registry } = buildExample("trees");
  assert.equal(valueToString(evalQuery("treesort (Cons 3 (Cons 1 (Cons 2 (Cons 1 Nil))))", store, names, registry)), "Cons 1 (Cons 1 (Cons 2 (Cons 3 Nil)))");
  assert.equal(valueToString(evalQuery("member 2 (fromList (Cons 3 (Cons 2 Nil)))", store, names, registry)), "true");
  // and the transpiled TypeScript agrees
  assert.equal(runT(ns, store, "member(2)(fromList(Cons(3)(Cons(2)(Nil))))"), "true");
});

test("result example (safe division)", () => {
  const { store, names, registry } = buildExample("result");
  assert.equal(valueToString(evalQuery("orElse 0 (safeDiv 10 2)", store, names, registry)), "5");
  assert.equal(valueToString(evalQuery("orElse 0 (safeDiv 1 0)", store, names, registry)), "0");
  assert.equal(valueToString(evalQuery("isOk (safeDiv 1 0)", store, names, registry)), "false");
});
