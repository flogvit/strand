import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileQueue } from "../src/swarm/queue.ts";

const CLI = join(process.cwd(), "src", "cli.ts");
const SWARM = join(process.cwd(), "src", "swarm", "cli.ts");

function strand(root: string, args: string[]): string {
  return execFileSync("npx", ["tsx", CLI, ...args], {
    env: { ...process.env, STRAND_ROOT: root },
    encoding: "utf8",
  });
}

function swarm(root: string, args: string[]): string {
  return execFileSync("npx", ["tsx", SWARM, ...args], {
    env: { ...process.env, STRAND_ROOT: root },
    encoding: "utf8",
  });
}

// #41: strand untested as a task generator — the coverage loop.
test("coverage opens one test task per untested definition, idempotently", () => {
  const root = mkdtempSync(join(tmpdir(), "strand-covloop-"));
  strand(root, ["init"]);
  strand(root, ["submit", "--as", "a", "--intent", "x", "--code",
    "def inc (n: Int) -> Int = n + 1\ndef dec (n: Int) -> Int = n - 1\ndef tst_inc -> Bool = inc 1 == 2"]);
  strand(root, ["merge"]);

  const out = swarm(root, ["coverage", "--root", root]);
  assert.match(out, /1 untested definition\(s\), opened 1 test task\(s\)/);

  const queue = new FileQueue(join(root, ".strand-swarm"));
  const tasks = queue.list();
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].role, "test");
  assert.deepEqual(tasks[0].target, ["dec"]);
  assert.equal(tasks[0].helperPrefix, "dec");

  // idempotent: a second run opens nothing new
  const again = swarm(root, ["coverage", "--root", root]);
  assert.match(again, /opened 0 test task\(s\)/);
  assert.equal(queue.list().length, 1);
});

test("coverage --require gates each untested definition on 'tests'", () => {
  const root = mkdtempSync(join(tmpdir(), "strand-covreq-"));
  strand(root, ["init"]);
  strand(root, ["submit", "--as", "a", "--intent", "x", "--code", "def dec (n: Int) -> Int = n - 1"]);
  strand(root, ["merge"]);

  swarm(root, ["coverage", "--root", root, "--require"]);
  // verify is now RED: 'tests' is required but not attested
  try {
    strand(root, ["verify"]);
    assert.fail("verify should exit nonzero");
  } catch (e) {
    const err = e as { status?: number; stdout?: string };
    assert.equal(err.status, 2);
    assert.match(err.stdout ?? "", /RED\s+dec: missing tests/);
  }
});
