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

const SRC =
  "def inc (n: Int) -> Int = n + 1\n" +
  "def dec (n: Int) -> Int = n - 1\n" +
  "def testInc -> Bool = inc 1 == 2\n" +
  "def testBad -> Bool = inc 1 == 99";

test("strand test runs Bool definitions and reports pass/fail", () => {
  const dir = mkdtempSync(join(tmpdir(), "strand-cov-"));
  run(dir, ["init"]);
  run(dir, ["submit", "--as", "a", "--intent", "x", "--code", SRC]);
  run(dir, ["merge"]);
  const r = run(dir, ["test"]);
  assert.equal(r.status, 1); // testBad fails
  assert.match(r.stdout, /ok\s+testInc/);
  assert.match(r.stdout, /FAIL\s+testBad/);
  assert.match(r.stdout, /1 passed, 1 failed/);
});

test("strand untested lists definitions no test reaches", () => {
  const dir = mkdtempSync(join(tmpdir(), "strand-cov-"));
  run(dir, ["init"]);
  run(dir, ["submit", "--as", "a", "--intent", "x", "--code", SRC]);
  run(dir, ["merge"]);
  const out = run(dir, ["untested"]).stdout;
  // testInc reaches inc; dec is reached by no test
  assert.match(out, /dec/);
  assert.doesNotMatch(out, /^ {2}inc$/m);
});
