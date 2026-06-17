import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(process.cwd(), "src", "ts", "cli.ts");

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

test("CLI: parallel TypeScript authoring parks only the contended definition", () => {
  const dir = mkdtempSync(join(tmpdir(), "strand-ts-"));
  run(dir, ["init"]);
  run(dir, ["submit", "--as", "alice", "--intent", "adder", "--code", "export function add(a: number, b: number): number { return a + b; }"]);
  run(dir, ["merge"]);
  run(dir, ["submit", "--as", "bob", "--intent", "d1", "--code", "export const double = (n: number): number => add(n, n);"]);
  run(dir, ["submit", "--as", "carol", "--intent", "d2", "--code", "export const double = (n: number): number => add(n, add(n, 0));"]);
  run(dir, ["submit", "--as", "dave", "--intent", "tripler", "--code", "export const triple = (n: number): number => add(add(n, n), n);"]);

  const m = run(dir, ["merge"]);
  assert.equal(m.status, 2);
  assert.match(m.stdout, /conflicts: double/);
  assert.match(m.stdout, /applied {2}: triple/);

  // the assembled real TypeScript runs through tsx
  assert.equal(run(dir, ["eval", "triple(5)"]).stdout.trim(), "15");
});

test("CLI: the real tsc green-gate rejects a type error", () => {
  const dir = mkdtempSync(join(tmpdir(), "strand-ts-"));
  run(dir, ["init"]);
  const r = run(dir, ["submit", "--as", "x", "--intent", "bad", "--code", 'export const oops: number = "nope";']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not assignable to type 'number'/);
});

test("CLI: resolving a parked conflict binds the chosen definition", () => {
  const dir = mkdtempSync(join(tmpdir(), "strand-ts-"));
  run(dir, ["init"]);
  run(dir, ["submit", "--as", "a", "--intent", "v1", "--code", "export const v = (): number => 1;"]);
  run(dir, ["submit", "--as", "b", "--intent", "v2", "--code", "export const v = (): number => 2;"]);
  run(dir, ["merge"]);
  const chosen = run(dir, ["conflicts"]).stdout.split("\n").find((l) => l.includes("b:"))!.trim().split(/\s+/)[1];
  run(dir, ["resolve", "v", chosen]);
  assert.equal(run(dir, ["eval", "v()"]).stdout.trim(), "2");
});
