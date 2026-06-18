import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(process.cwd(), "src", "cli.ts");

function run(dir: string, args: string[]): { status: number; stdout: string } {
  try {
    return { status: 0, stdout: execFileSync("npx", ["tsx", CLI, ...args], { env: { ...process.env, STRAND_ROOT: dir }, encoding: "utf8" }) };
  } catch (e) {
    const err = e as { status?: number; stdout?: Buffer | string };
    return { status: err.status ?? 1, stdout: err.stdout?.toString() ?? "" };
  }
}

const SRC = "def inc (n: Int) -> Int = n + 1\ndef testInc -> Bool = inc 1 == 2";

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "strand-att-"));
  run(dir, ["init"]);
  run(dir, ["submit", "--as", "a", "--intent", "x", "--code", SRC]);
  run(dir, ["merge"]);
  return dir;
}

test("require + attest + verify", () => {
  const dir = repo();
  run(dir, ["require", "inc", "review"]);
  const red = run(dir, ["verify"]);
  assert.equal(red.status, 2);
  assert.match(red.stdout, /RED\s+inc: missing review/);

  run(dir, ["attest", "inc", "review"]);
  const green = run(dir, ["verify"]);
  assert.equal(green.status, 0);
  assert.match(green.stdout, /all required checks attested/);
});

test("a green merge auto-attests typecheck", () => {
  const dir = repo();
  run(dir, ["require", "inc", "typecheck"]);
  assert.equal(run(dir, ["verify"]).status, 0); // typecheck already attested by merge
});

test("strand test attests `tests` for the covered set", () => {
  const dir = repo();
  run(dir, ["require", "inc", "tests"]);
  assert.equal(run(dir, ["verify"]).status, 2); // tests not attested yet
  run(dir, ["test"]); // testInc passes and covers inc
  assert.equal(run(dir, ["verify"]).status, 0);
});
