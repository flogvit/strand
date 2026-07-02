import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileQueue } from "../src/swarm/queue.ts";
import { work } from "../src/swarm/worker.ts";
import type { Agent, AgentContext, AgentResult } from "../src/swarm/adapter.ts";

const CLI = join(process.cwd(), "src", "cli.ts");

function strand(root: string, args: string[]): string {
  return execFileSync("npx", ["tsx", CLI, ...args], {
    env: { ...process.env, STRAND_ROOT: root },
    encoding: "utf8",
  });
}

/** A deterministic provider standing in for a real LLM: it returns known-good
 *  Strand for each target, so the test exercises the orchestration loop (queue →
 *  agent → green-gate → merge → unblock), not a model. */
class FakeAgent implements Agent {
  readonly provider = "fake";
  constructor(private readonly bodies: Record<string, string>) {}
  run(ctx: AgentContext): AgentResult {
    const code = ctx.task.target.map((t) => this.bodies[t] ?? "").join("\n");
    return { code, report: "fake" };
  }
}

test("a worker drives a dependency graph green through the green-gate", async () => {
  const root = mkdtempSync(join(tmpdir(), "strand-swarm-e2e-"));
  strand(root, ["init"]);

  const queue = new FileQueue(join(root, ".strand-swarm"));
  const add = queue.add({ title: "code add", role: "code", intent: "adder", target: ["add"], deps: [] });
  queue.add({ title: "code double", role: "code", intent: "doubler", target: ["double"], deps: [add.id] });

  const agent = new FakeAgent({
    add: "def add (a: Int) (b: Int) -> Int = a + b",
    double: "def double (n: Int) -> Int = add n n",
  });

  const summary = await work(queue, agent, { root, workerId: "w1", maxIdlePolls: 2, pollMs: 10 });

  assert.equal(summary.done.length, 2, "both tasks completed");
  assert.equal(summary.parked.length, 0, "nothing parked");
  assert.ok(queue.list().every((t) => t.state === "done"), "queue fully drained to done");

  // The assembled namespace actually computes: double depends on add, both landed.
  assert.equal(strand(root, ["eval", "double 21"]).trim(), "42");
});
