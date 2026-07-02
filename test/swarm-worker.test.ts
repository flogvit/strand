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

// #50: provider failures are classified and the worker reacts per class.
test("classifyExecError: timeout, missing binary, auth, rate limit, unknown", async () => {
  const { classifyExecError } = await import("../src/swarm/adapter.ts");
  const c = (e: object) => classifyExecError(e, "claude", 1000);
  assert.equal(c({ message: "x", killed: true, signal: "SIGKILL" }).kind, "timeout");
  assert.equal(c({ message: "x", code: "ETIMEDOUT" }).kind, "timeout");
  assert.equal(c({ message: "spawn claude ENOENT", code: "ENOENT" }).kind, "permanent");
  assert.equal(c({ message: "x", stderr: "Error: 401 Unauthorized — invalid API key" }).kind, "permanent");
  assert.equal(c({ message: "x", stderr: "429 Too Many Requests: rate limit exceeded" }).kind, "transient");
  assert.equal(c({ message: "x", stderr: "an inscrutable explosion" }).kind, "transient");
});

test("a hung provider subprocess is killed and reported as a timeout", async () => {
  const { CliAgent, ProviderError } = await import("../src/swarm/adapter.ts");
  const agent = new CliAgent({ provider: "sleep", command: "sleep", args: ["30"], timeoutMs: 200 });
  const ctx = {
    task: { id: "t", title: "t", role: "code" as const, intent: "i", target: ["x"], deps: [], state: "ready" as const },
    namespaceSource: "",
  };
  try {
    agent.run(ctx);
    assert.fail("should have thrown");
  } catch (e) {
    assert.ok(e instanceof ProviderError);
    assert.equal(e.kind, "timeout");
    assert.match(e.message, /provider timeout/);
  }
});

test("transient provider failures back off and burn no attempt; the task still lands", async () => {
  const { ProviderError } = await import("../src/swarm/adapter.ts");
  const root = mkdtempSync(join(tmpdir(), "strand-swarm-transient-"));
  strand(root, ["init"]);
  const queue = new FileQueue(join(root, ".strand-swarm"));
  queue.add({ title: "code add", role: "code", intent: "adder", target: ["add"], deps: [] });

  let calls = 0;
  const flaky: Agent = {
    provider: "flaky",
    run(ctx: AgentContext): AgentResult {
      if (++calls <= 4) throw new ProviderError("transient", "rate limited");
      return { code: "def add (a: Int) (b: Int) -> Int = a + b", report: "ok" };
    },
  };

  // maxAttempts=3 < 4 transient failures: only because transient failures burn
  // no attempt can the fifth call succeed instead of the task parking.
  const summary = await work(queue, flaky, { root, workerId: "w1", maxIdlePolls: 2, pollMs: 5, maxAttempts: 3, backoffMs: 1 });
  assert.equal(summary.done.length, 1, "task landed after transient failures");
  assert.equal(summary.provider.transient, 4);
  assert.equal(summary.stopped, undefined);
});

test("a permanent provider failure stops the worker and hands the task back", async () => {
  const { ProviderError } = await import("../src/swarm/adapter.ts");
  const root = mkdtempSync(join(tmpdir(), "strand-swarm-permanent-"));
  strand(root, ["init"]);
  const queue = new FileQueue(join(root, ".strand-swarm"));
  queue.add({ title: "code add", role: "code", intent: "adder", target: ["add"], deps: [] });

  const dead: Agent = {
    provider: "dead",
    run(): AgentResult {
      throw new ProviderError("permanent", "invalid API key");
    },
  };

  const summary = await work(queue, dead, { root, workerId: "w1", maxIdlePolls: 2, pollMs: 5 });
  assert.equal(summary.done.length, 0);
  assert.equal(summary.provider.permanent, 1);
  assert.match(summary.stopped ?? "", /invalid API key/);
  const t = queue.list()[0];
  assert.equal(t.state, "ready", "task handed back for another worker");
  assert.equal(t.assignee, null, "task unassigned");
});

// #52: a planner-assigned helper prefix is enforced mechanically before submit.
test("helperPrefix: unprefixed helpers are rejected with feedback; prefixed ones land", async () => {
  const root = mkdtempSync(join(tmpdir(), "strand-swarm-prefix-"));
  strand(root, ["init"]);
  const queue = new FileQueue(join(root, ".strand-swarm"));
  queue.add({ title: "code sortBy", role: "code", intent: "sorter", target: ["sortBy"], deps: [], helperPrefix: "sortBy" });

  let sawFeedback = "";
  let calls = 0;
  const agent: Agent = {
    provider: "fake",
    run(ctx: AgentContext): AgentResult {
      calls++;
      sawFeedback = ctx.feedback ?? "";
      if (calls === 1) {
        // invents a bare helper the planner never named — must be rejected
        return { code: "def go (n: Int) -> Int = n\ndef sortBy (n: Int) -> Int = go n", report: "bad" };
      }
      return { code: "def sortByGo (n: Int) -> Int = n\ndef sortBy (n: Int) -> Int = sortByGo n", report: "good" };
    },
  };

  const summary = await work(queue, agent, { root, workerId: "w1", maxIdlePolls: 2, pollMs: 5 });
  assert.equal(summary.done.length, 1, "task landed on the corrected attempt");
  assert.match(sawFeedback, /naming convention violated: go/);
  // the bare helper never reached the store
  assert.throws(() => strand(root, ["show", "go"]));
});

// #51: done means attested — a test task completes only when the suite is
// green and its targets sit in the attested closure.
test("a test task whose tests never reach the target is rejected", async () => {
  const root = mkdtempSync(join(tmpdir(), "strand-swarm-attest-"));
  strand(root, ["init"]);
  const queue = new FileQueue(join(root, ".strand-swarm"));
  const code = queue.add({ title: "code add", role: "code", intent: "adder", target: ["add"], deps: [], require: ["tests"] });
  queue.add({ title: "test add", role: "test", intent: "verify add", target: ["add"], deps: [code.id] });

  let testAttempts = 0;
  const agent: Agent = {
    provider: "fake",
    run(ctx: AgentContext): AgentResult {
      if (ctx.task.role === "code") return { code: "def add (a: Int) (b: Int) -> Int = a + b", report: "ok" };
      testAttempts++;
      // first attempt: a green test that never touches add — must be rejected
      if (testAttempts === 1) return { code: "def tst_addTrivial -> Bool = true", report: "lazy" };
      return { code: "def tst_addWorks -> Bool = add 2 3 == 5", report: "real" };
    },
  };

  const summary = await work(queue, agent, { root, workerId: "w1", maxIdlePolls: 2, pollMs: 5 });
  assert.equal(summary.done.length, 2, "code + (eventually) test task done");
  assert.ok(testAttempts >= 2, "the lazy test attempt was rejected");

  // the require:["tests"] carried by the code task now verifies green
  const out = strand(root, ["verify"]);
  assert.match(out, /green add/);
  assert.match(out, /all required checks attested/);
});

test("a test task with a red suite does not complete", async () => {
  const root = mkdtempSync(join(tmpdir(), "strand-swarm-redsuite-"));
  strand(root, ["init"]);
  const queue = new FileQueue(join(root, ".strand-swarm"));
  const code = queue.add({ title: "code add", role: "code", intent: "adder", target: ["add"], deps: [] });
  queue.add({ title: "test add", role: "test", intent: "verify add", target: ["add"], deps: [code.id] });

  const agent: Agent = {
    provider: "fake",
    run(ctx: AgentContext): AgentResult {
      if (ctx.task.role === "code") return { code: "def add (a: Int) (b: Int) -> Int = a + b", report: "ok" };
      // types check, but the assertion is wrong — the suite goes red
      return { code: "def tst_addWrong -> Bool = add 2 3 == 6", report: "wrong" };
    },
  };

  const summary = await work(queue, agent, { root, workerId: "w1", maxIdlePolls: 2, pollMs: 5, maxAttempts: 2 });
  assert.equal(summary.done.length, 1, "only the code task completed");
  const testTask = queue.list().find((t) => t.role === "test")!;
  assert.equal(testTask.state, "parked", "red tests parked the task after the attempt budget");
});
