import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/core/store.ts";
import { compileProgram } from "../src/pipeline.ts";
import { emitModule } from "../src/backend/emit_ts.ts";
import type { Namespace } from "../src/model.ts";

function build(src: string): { ns: Namespace; store: Store } {
  const store = new Store();
  const ns: Namespace = new Map();
  const binds = compileProgram(src, store, new Map());
  for (const b of binds) ns.set(b.name, { hash: b.hash, intent: "", by: "test" });
  return { ns, store };
}

test("emits a const per definition", () => {
  const { ns, store } = build("def add (a: Int) (b: Int) -> Int = a + b\ndef double (n: Int) -> Int = add n n");
  const ts = emitModule(ns, store);
  assert.match(ts, /export const add = \(a: number\) => \(b: number\): number => \(a \+ b\);/);
  assert.match(ts, /export const double = \(n: number\): number => add\(n\)\(n\);/);
});

test("emits definitions in dependency order (dependency before user)", () => {
  const { ns, store } = build("def add (a: Int) (b: Int) -> Int = a + b\ndef double (n: Int) -> Int = add n n");
  const ts = emitModule(ns, store);
  assert.ok(ts.indexOf("const add") < ts.indexOf("const double"));
});

test("maps == to === and if to a ternary", () => {
  const { ns, store } = build("def eq (a: Int) (b: Int) -> Bool = a == b\ndef pick (c: Bool) -> Int = if c then 1 else 0");
  const ts = emitModule(ns, store);
  assert.match(ts, /a === b/);
  assert.match(ts, /\? 1 : 0/);
});

// #34: importing a projection must not execute it.
test("zero-arg defs emit as memoized thunks: import runs nothing, first call pays, later calls reuse", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { execFileSync } = await import("node:child_process");
  const { ns, store } = build(
    'foreign loud -> Int = "(() => { console.log(\\"evaluated\\"); return 42; })()"\n' +
      "def twice -> Int = loud + loud",
  );
  const ts = emitModule(ns, store);
  const dir = mkdtempSync(join(tmpdir(), "strand-lazy-"));
  const file = join(dir, "m.ts");
  // Import alone must print nothing; forcing twice() evaluates loud exactly once.
  writeFileSync(file, ts + '\nconsole.log("imported");\nconsole.log(String(twice()));\n');
  const out = execFileSync("npx", ["tsx", file], { encoding: "utf8" }).trim().split("\n");
  assert.deepEqual(out, ["imported", "evaluated", "84"]);
});
