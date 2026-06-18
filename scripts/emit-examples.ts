import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Store } from "../src/core/store.ts";
import { compileProgram } from "../src/pipeline.ts";
import { emitModule } from "../src/backend/emit_ts.ts";
import type { Namespace } from "../src/model.ts";

// Transpile each example (prelude + example) to TypeScript so the Strand -> TS
// mapping is visible in examples/out/.
const root = process.cwd();
const prelude = readFileSync(join(root, "lib", "prelude.strand"), "utf8");
const examples = ["program", "lists", "trees", "result"];

mkdirSync(join(root, "examples", "out"), { recursive: true });

for (const name of examples) {
  const src = prelude + "\n" + readFileSync(join(root, "examples", `${name}.strand`), "utf8");
  const store = new Store();
  const ns: Namespace = new Map();
  for (const b of compileProgram(src, store, new Map(), [])) ns.set(b.name, { hash: b.hash, intent: "", by: name });
  writeFileSync(join(root, "examples", "out", `${name}.ts`), emitModule(ns, store));
  console.log(`emitted examples/out/${name}.ts`);
}
