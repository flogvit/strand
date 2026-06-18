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

function repo(src: string): string {
  const dir = mkdtempSync(join(tmpdir(), "strand-part-"));
  cli(dir, ["init"]);
  cli(dir, ["submit", "--as", "a", "--intent", "x", "--code", src]);
  cli(dir, ["merge"]);
  return dir;
}

test("independent components go to different agents, intact", () => {
  const dir = repo("def a -> Int = 1\ndef useA -> Int = a + 1\ndef b -> Int = 2\ndef useB -> Int = b + 1");
  const lines = cli(dir, ["partition", "--agents", "2"]).split("\n").filter((l) => l.startsWith("agent"));
  const aLine = lines.find((l) => /\ba\b/.test(l))!;
  const bLine = lines.find((l) => /\bb\b/.test(l))!;
  assert.match(aLine, /useA/); // a and its dependent stay together
  assert.match(bLine, /useB/);
  assert.notEqual(aLine, bLine); // different agents
});

test("a connected component is not split, and the contention is reported", () => {
  const dir = repo("def x -> Int = 1\ndef y -> Int = x + 1\ndef z -> Int = y + 1");
  const out = cli(dir, ["partition", "--agents", "2"]);
  const agentLines = out.split("\n").filter((l) => l.startsWith("agent"));
  const withDefs = agentLines.filter((l) => /[xyz]/.test(l.split(":")[1] ?? ""));
  assert.equal(withDefs.length, 1); // all three in one bucket
  assert.match(out, /only 1 independent component/);
});
