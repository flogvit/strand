import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(process.cwd(), "src", "cli.ts");

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

function run(dir: string, args: string[]): Run {
  try {
    const stdout = execFileSync("npx", ["tsx", CLI, ...args], {
      env: { ...process.env, STRAND_ROOT: dir },
      encoding: "utf8",
    });
    return { status: 0, stdout, stderr: "" };
  } catch (e) {
    const err = e as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      status: err.status ?? 1,
      stdout: err.stdout?.toString() ?? "",
      stderr: err.stderr?.toString() ?? "",
    };
  }
}

test("CLI: parallel submit, merge parks only the contended name, transpiled run matches interpreter", () => {
  const dir = mkdtempSync(join(tmpdir(), "strand-"));
  run(dir, ["init"]);
  run(dir, ["submit", "--as", "a12", "--intent", "validate email", "--code", "def auth -> Int = 1\ndef signup -> Int = auth + 6"]);
  run(dir, ["submit", "--as", "a37", "--intent", "hash password", "--code", "def signup -> Int = 99"]);
  run(dir, ["submit", "--as", "a50", "--intent", "rate limit", "--code", "def rate -> Int = 3\ndef login -> Int = rate + 100"]);

  const m = run(dir, ["merge"]);
  assert.equal(m.status, 2); // non-zero because a conflict was parked
  assert.match(m.stdout, /conflicts: signup/);
  assert.match(m.stdout, /applied {2}: .*login/);
  assert.match(m.stdout, /rejected : none/);

  // interpreter and transpiled-TS backend must agree
  assert.equal(run(dir, ["eval", "login"]).stdout.trim(), "103");
  assert.equal(run(dir, ["run", "login"]).stdout.trim(), "103");
});

test("CLI: resolving the parked conflict binds the chosen content", () => {
  const dir = mkdtempSync(join(tmpdir(), "strand-"));
  run(dir, ["init"]);
  run(dir, ["submit", "--as", "x", "--intent", "v1", "--code", "def signup -> Int = 1"]);
  run(dir, ["submit", "--as", "y", "--intent", "v2", "--code", "def signup -> Int = 2"]);
  run(dir, ["merge"]);

  const conflicts = run(dir, ["conflicts"]).stdout;
  const chosen = conflicts.split("\n").find((l) => l.includes("y:"))!.trim().split(/\s+/)[1];
  run(dir, ["resolve", "signup", chosen]);

  assert.equal(run(dir, ["eval", "signup"]).stdout.trim(), "2");
  assert.match(run(dir, ["conflicts"]).stdout, /no parked conflicts/);
});

test("CLI: the green-gate rejects an ill-typed submission", () => {
  const dir = mkdtempSync(join(tmpdir(), "strand-"));
  run(dir, ["init"]);
  const r = run(dir, ["submit", "--as", "x", "--intent", "bad", "--code", "def bad -> Int = true"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /type error/);
});

test("CLI: state persists across invocations", () => {
  const dir = mkdtempSync(join(tmpdir(), "strand-"));
  run(dir, ["init"]);
  run(dir, ["submit", "--as", "x", "--intent", "n", "--code", "def n -> Int = 41"]);
  run(dir, ["merge"]);
  // a fresh process must see the persisted namespace
  assert.equal(run(dir, ["eval", "n + 1"]).stdout.trim(), "42");
});
