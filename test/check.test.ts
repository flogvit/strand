import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(process.cwd(), "src", "cli.ts");

function run(dir: string, args: string[]): { status: number; stdout: string; stderr: string } {
  try {
    return { status: 0, stdout: execFileSync("npx", ["tsx", CLI, ...args], { env: { ...process.env, STRAND_ROOT: dir }, encoding: "utf8" }), stderr: "" };
  } catch (e) {
    const err = e as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    return { status: err.status ?? 1, stdout: err.stdout?.toString() ?? "", stderr: err.stderr?.toString() ?? "" };
  }
}

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "strand-chk-"));
  run(dir, ["init"]);
  run(dir, ["submit", "--as", "a", "--intent", "x", "--code", "def base -> Int = 1"]);
  run(dir, ["merge"]);
  return dir;
}

test("check passes for valid code against the namespace", () => {
  const dir = repo();
  const file = join(dir, "good.strand");
  writeFileSync(file, "def f -> Int = base + 1");
  const r = run(dir, ["check", file]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /ok:/);
});

test("check reports a type error", () => {
  const dir = repo();
  const file = join(dir, "bad.strand");
  writeFileSync(file, "def g -> Int = true");
  const r = run(dir, ["check", file]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /type error/);
});
