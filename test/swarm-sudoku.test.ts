import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileQueue } from "../src/swarm/queue.ts";
import { seed } from "../src/swarm/plan.ts";
import { work } from "../src/swarm/worker.ts";
import type { Agent, AgentContext, AgentResult } from "../src/swarm/adapter.ts";

const CLI = join(process.cwd(), "src", "cli.ts");
function strand(root: string, args: string[]): string {
  return execFileSync("npx", ["tsx", CLI, ...args], {
    env: { ...process.env, STRAND_ROOT: root },
    encoding: "utf8",
  });
}

/** The definition(s) a "perfect" coder agent produces for each plan target, in
 *  dependency order. Mirrors examples/sudoku.strand, sliced to the plan's graph. */
const CODE: Record<string, string> = {
  Grid: `def zeros (n: Int) -> List Int = if n < 1 then Nil else Cons 0 (zeros (n - 1))
def emptyBoard -> List Int = zeros 81
def nth (i: Int) (xs: List Int) -> Int = match xs { Nil -> 0 | Cons h t -> if i < 1 then h else nth (i - 1) t }
def setAt (i: Int) (v: Int) (xs: List Int) -> List Int = match xs { Nil -> Nil | Cons h t -> if i < 1 then Cons v t else Cons h (setAt (i - 1) v t) }`,
  rowOk: `def rowConf (k: Int) (i: Int) (v: Int) (b: List Int) -> Bool =
  if k > 8 then false
  else if (i / 9) * 9 + k == i then rowConf (k + 1) i v b
  else if nth ((i / 9) * 9 + k) b == v then true
  else rowConf (k + 1) i v b
def rowOk (i: Int) (v: Int) (b: List Int) -> Bool = if rowConf 0 i v b then false else true`,
  colOk: `def colConf (k: Int) (i: Int) (v: Int) (b: List Int) -> Bool =
  if k > 8 then false
  else if k * 9 + (i % 9) == i then colConf (k + 1) i v b
  else if nth (k * 9 + (i % 9)) b == v then true
  else colConf (k + 1) i v b
def colOk (i: Int) (v: Int) (b: List Int) -> Bool = if colConf 0 i v b then false else true`,
  boxOk: `def boxConf (k: Int) (i: Int) (v: Int) (b: List Int) -> Bool =
  if k > 8 then false
  else if (i / 9 / 3 * 3 + k / 3) * 9 + (i % 9 / 3 * 3 + k % 3) == i then boxConf (k + 1) i v b
  else if nth ((i / 9 / 3 * 3 + k / 3) * 9 + (i % 9 / 3 * 3 + k % 3)) b == v then true
  else boxConf (k + 1) i v b
def boxOk (i: Int) (v: Int) (b: List Int) -> Bool = if boxConf 0 i v b then false else true`,
  valid: `def valid (i: Int) (v: Int) (b: List Int) -> Bool = rowOk i v b && colOk i v b && boxOk i v b
def firstEmpty (idx: Int) (b: List Int) -> Int =
  if idx > 80 then 81 else if nth idx b == 0 then idx else firstEmpty (idx + 1) b`,
  solve: `def solve (seed: Int) (b: List Int) -> Option (List Int) =
  if firstEmpty 0 b > 80 then Some b else tryK (firstEmpty 0 b) 0 seed b
def tryK (i: Int) (k: Int) (seed: Int) (b: List Int) -> Option (List Int) =
  if k > 8 then None
  else if valid i ((seed + k) % 9 + 1) b then
    match solve seed (setAt i ((seed + k) % 9 + 1) b) { Some s -> Some s | None -> tryK i (k + 1) seed b }
  else tryK i (k + 1) seed b`,
  countSolutions: `def countSolutions (b: List Int) (cap: Int) -> Int =
  if cap < 1 then 0 else if firstEmpty 0 b > 80 then 1 else countVals (firstEmpty 0 b) 1 b cap
def countVals (i: Int) (v: Int) (b: List Int) (cap: Int) -> Int =
  if v > 9 then 0
  else if cap < 1 then 0
  else if valid i v b then let here = countSolutions (setAt i v b) cap in here + countVals i (v + 1) b (cap - here)
  else countVals i (v + 1) b cap`,
  isUnique: `def isUnique (b: List Int) -> Bool = countSolutions b 2 == 1`,
  fullBoard: `def fullBoard (seed: Int) -> List Int = match solve seed emptyBoard { Some b -> b | None -> emptyBoard }`,
  dig: `def dig (j: Int) (start: Int) (holes: Int) (b: List Int) -> List Int =
  if j > 80 then b
  else if holes < 1 then b
  else if nth ((start + j) % 81) b == 0 then dig (j + 1) start holes b
  else let dug = setAt ((start + j) % 81) 0 b in if isUnique dug then dig (j + 1) start (holes - 1) dug else dig (j + 1) start holes b`,
  generate: `def generate (seed: Int) (holes: Int) -> List Int = dig 0 seed holes (fullBoard seed)`,
};

/** A tester agent's Bool check per target (referencing only already-available defs). */
const TESTS: Record<string, string> = {
  Grid: `def tst_Grid -> Bool = nth 3 (setAt 3 7 emptyBoard) == 7`,
  rowOk: `def tst_rowOk -> Bool = rowOk 0 5 emptyBoard`,
  colOk: `def tst_colOk -> Bool = colOk 0 5 emptyBoard`,
  boxOk: `def tst_boxOk -> Bool = boxOk 0 5 emptyBoard`,
  valid: `def tst_valid -> Bool = valid 0 1 emptyBoard`,
  solve: `def tst_solve -> Bool = match solve 0 emptyBoard { Some b -> true | None -> false }`,
  countSolutions: `def tst_countSolutions -> Bool = countSolutions emptyBoard 2 == 2`,
  isUnique: `def tst_isUnique -> Bool = isUnique (setAt 0 1 emptyBoard) == false`,
  fullBoard: `def tst_fullBoard -> Bool = nth 0 (fullBoard 0) > 0`,
  dig: `def tst_dig -> Bool = isUnique (dig 0 0 5 (fullBoard 0))`,
  generate: `def tst_generate -> Bool = isUnique (generate 0 8)`,
};

/** A scripted stand-in for a provider-agnostic agent: returns known-good Strand for
 *  each task, so the test exercises the whole orchestration (plan → queue → many
 *  workers → green-gate → assembled program), independent of any real model. */
class ScriptedAgent implements Agent {
  readonly provider = "scripted";
  run(ctx: AgentContext): AgentResult {
    const name = ctx.task.target[0];
    const code = ctx.task.role === "test" ? TESTS[name] : CODE[name];
    return { code: code ?? "", report: `${ctx.task.role} ${name}` };
  }
}

test("a swarm of workers autonomously builds the Sudoku generator green", { timeout: 480_000 }, () => {
  const root = mkdtempSync(join(tmpdir(), "strand-swarm-sudoku-"));
  strand(root, ["init"]);
  strand(root, ["submit", "--as", "prelude", "--intent", "prelude", "--file", join(process.cwd(), "lib", "prelude.strand")]);
  strand(root, ["merge"]);

  const queue = new FileQueue(join(root, ".strand-swarm"));
  const tasks = seed(queue);
  assert.equal(tasks.length, 22, "11 code + 11 test tasks seeded");

  // A pool of workers pulls from the shared queue until it drains. Work-stealing:
  // each worker claims whatever is ready; dependencies gate the order.
  const agent = new ScriptedAgent();
  const workers = Array.from({ length: 12 }, (_, i) => `agent-${i + 1}`);
  for (let round = 0; round < 60 && queue.list().some((t) => t.state !== "done"); round++) {
    for (const w of workers) work(queue, agent, { root, workerId: w, maxIdlePolls: 1, pollMs: 0 });
  }

  assert.ok(queue.list().every((t) => t.state === "done"), "every task completed");

  // The assembled namespace actually produces a uniquely-solvable puzzle.
  assert.equal(strand(root, ["eval", "isUnique (generate 0 8)"]).trim(), "true");

  // And every tester's check passes when run as first-class Strand tests.
  const testOut = strand(root, ["test"]);
  assert.match(testOut, /tst_generate/);
  assert.match(testOut, /11 passed, 0 failed/);
});
