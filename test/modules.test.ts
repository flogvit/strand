import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(process.cwd(), "src", "cli.ts");

function cli(dir: string, args: string[]): string {
  return execFileSync("npx", ["tsx", CLI, ...args], { env: { ...process.env, STRAND_ROOT: dir }, encoding: "utf8" });
}

function fresh(): string {
  const dir = mkdtempSync(join(tmpdir(), "strand-mod-"));
  cli(dir, ["init"]);
  return dir;
}

test("a module qualifies its value names; cross-module refs use ::", () => {
  const dir = fresh();
  cli(dir, ["submit", "--as", "a", "--intent", "math", "--code", "module Math\ndef add a b = a + b\ndef double n = add n n"]);
  cli(dir, ["merge"]);
  assert.equal(cli(dir, ["eval", "Math::double 5"]).trim(), "10");
  // a later, separate submission references the module qualified
  cli(dir, ["submit", "--as", "b", "--intent", "use", "--code", "def useIt -> Int = Math::add 10 20"]);
  cli(dir, ["merge"]);
  assert.equal(cli(dir, ["eval", "useIt"]).trim(), "30");
});

test("two modules can define the same name without colliding", () => {
  const dir = fresh();
  cli(dir, ["submit", "--as", "a", "--intent", "A", "--code", "module A\ndef val = 1"]);
  cli(dir, ["merge"]);
  cli(dir, ["submit", "--as", "b", "--intent", "B", "--code", "module B\ndef val = 2"]);
  cli(dir, ["merge"]);
  assert.equal(cli(dir, ["eval", "A::val"]).trim(), "1");
  assert.equal(cli(dir, ["eval", "B::val"]).trim(), "2");
});
