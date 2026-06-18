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

function step(dir: string, by: string, intent: string, code: string): void {
  cli(dir, ["submit", "--as", by, "--intent", intent, "--code", code]);
  cli(dir, ["merge"]);
}

test("distill collapses many steps on a name into its final version", () => {
  const dir = mkdtempSync(join(tmpdir(), "strand-dist-"));
  cli(dir, ["init"]);
  step(dir, "a", "first try", "def signup -> Int = 1");
  step(dir, "a", "second try", "def signup -> Int = 2");
  step(dir, "a", "final", "def signup -> Int = 3");
  step(dir, "b", "login", "def login -> Int = 9");

  // the work plane has all four steps
  const log = cli(dir, ["log"]);
  assert.equal(log.trim().split("\n").length, 4);

  // distill drops the dead steps and keeps the final
  const dist = cli(dir, ["distill"]);
  assert.match(dist, /signup.*\[2 earlier version\(s\) superseded\]/);
  assert.match(dist, /4 step\(s\).*2 superseded step\(s\) distilled away/);

  // the final value is the latest
  assert.equal(cli(dir, ["eval", "signup"]).trim(), "3");
});
