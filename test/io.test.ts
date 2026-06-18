import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/core/store.ts";
import { compileProgram } from "../src/pipeline.ts";
import { emitModule } from "../src/backend/emit_ts.ts";
import { StrandTypeError } from "../src/errors.ts";
import type { Namespace } from "../src/model.ts";

const CLI = join(process.cwd(), "src", "cli.ts");

function cli(dir: string, args: string[]): string {
  return execFileSync("npx", ["tsx", CLI, ...args], { env: { ...process.env, STRAND_ROOT: dir }, encoding: "utf8" });
}

function repo(src: string): string {
  const dir = mkdtempSync(join(tmpdir(), "strand-io-"));
  cli(dir, ["init"]);
  cli(dir, ["submit", "--as", "a", "--intent", "x", "--code", src]);
  cli(dir, ["merge"]);
  return dir;
}

test("IO: print runs as an effect via the interpreter (strand exec)", () => {
  const dir = repo('def hello -> IO Unit = print "hi"');
  assert.equal(cli(dir, ["exec", "hello"]).trim(), "hi");
});

test("IO: andThen sequences effects", () => {
  const dir = repo('def prog -> IO Unit = andThen (print "a") (fn (u: Unit) -> print "b")');
  assert.equal(cli(dir, ["exec", "prog"]).trim(), "a\nb");
});

test("IO: a value threads through andThen", () => {
  const dir = repo('def prog -> IO Unit = andThen (pure 42) (fn (x: Int) -> print "got")');
  assert.equal(cli(dir, ["exec", "prog"]).trim(), "got");
});

test("IO transpiles to TypeScript and runs", () => {
  const store = new Store();
  const ns: Namespace = new Map();
  for (const b of compileProgram('def hello -> IO Unit = print "hi"', store, new Map(), [])) {
    ns.set(b.name, { hash: b.hash, intent: "", by: "t" });
  }
  const dir = mkdtempSync(join(tmpdir(), "strand-io-ts-"));
  const file = join(dir, "m.ts");
  writeFileSync(file, emitModule(ns, store) + "\nhello();\n");
  assert.equal(execFileSync("npx", ["tsx", file], { encoding: "utf8" }).trim(), "hi");
});

test("the type checker rejects ill-typed IO (print on an Int)", () => {
  assert.throws(() => compileProgram("def bad -> IO Unit = print 5", new Store(), new Map(), []), StrandTypeError);
});
