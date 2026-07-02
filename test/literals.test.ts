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
  const dir = mkdtempSync(join(tmpdir(), "strand-lit-"));
  const file = join(dir, "m.ts");
  writeFileSync(file, emitModule(ns, store) + `\nconsole.log(String(${expr}));\n`);
  return execFileSync("npx", ["tsx", file], { encoding: "utf8" }).trim();
}

test("negative integer literals (interpreter and transpiled)", () => {
  const { store, ns, names, registry } = build("def neg -> Int = -5\ndef sub (n: Int) -> Int = -n");
  assert.equal(valueToString(evalQuery("neg", store, names, registry)), "-5");
  assert.equal(valueToString(evalQuery("sub 3", store, names, registry)), "-3");
  assert.equal(runT(ns, store, "neg()"), "-5");
  assert.equal(runT(ns, store, "sub(3)"), "-3");
});

test("string escape sequences (interpreter and transpiled)", () => {
  const { store, ns, names, registry } = build('def s -> Text = "a\\tb"');
  assert.equal(valueToString(evalQuery("s", store, names, registry)), '"a\\tb"');
  assert.equal(runT(ns, store, "s()"), "a\tb");
});

test("escaped quotes and backslashes", () => {
  const { store, names, registry } = build('def s -> Text = "say \\"hi\\""');
  assert.equal(valueToString(evalQuery("s", store, names, registry)), '"say \\"hi\\""');
});
