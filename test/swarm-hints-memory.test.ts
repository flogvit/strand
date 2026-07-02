import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initRepo, loadRepo, saveRepo } from "../src/persist.ts";
import { mergeRepo } from "../src/repo.ts";
import { compileProgram } from "../src/pipeline.ts";
import { announce } from "../src/distributed/hints.ts";
import { record } from "../src/distributed/memory.ts";
import { FileQueue } from "../src/swarm/queue.ts";
import { work } from "../src/swarm/worker.ts";
import { buildPrompt } from "../src/swarm/adapter.ts";
import type { Agent, AgentContext, AgentResult } from "../src/swarm/adapter.ts";
import type { Hash } from "../src/core/term.ts";

// #33: the coordination and memory layers become live worker behavior — agents
// read the decisions governing a definition before touching it, record the
// assumptions they take under ambiguity instead of stopping to ask, and steer
// around hot names another agent is actively on.

function author(root: string, by: string, src: string): void {
  const repo = loadRepo(root);
  const names = new Map<string, Hash>([...repo.namespace].map(([n, b]) => [n, b.hash]));
  const binds = compileProgram(src, repo.store, names);
  repo.pending.push({ by, intent: "seed", binds: binds.map((b) => ({ name: b.name, hash: b.hash })) });
  mergeRepo(repo);
  saveRepo(root, repo);
}

function fresh(): string {
  const root = mkdtempSync(join(tmpdir(), "strand-hints-mem-"));
  initRepo(root);
  return root;
}

class CapturingAgent implements Agent {
  readonly provider = "fake";
  contexts: AgentContext[] = [];
  constructor(private readonly bodies: Record<string, string>) {}
  run(ctx: AgentContext): AgentResult {
    this.contexts.push(ctx);
    const code = ctx.task.target.map((t) => this.bodies[t] ?? "").join("\n");
    return { code, report: "fake" };
  }
}

test("the governing decisions for a target reach the agent's prompt", async () => {
  const root = fresh();
  const repo = loadRepo(root);
  repo.memory = record(repo.memory, {
    type: "convention",
    subject: "arithmetic",
    body: "all arithmetic stays in Int; never introduce Float",
    by: "agent-0",
    targets: ["add"],
  });
  saveRepo(root, repo);

  const queue = new FileQueue(join(root, ".strand-swarm"));
  queue.add({ title: "code add", role: "code", intent: "adder", target: ["add"], deps: [] });
  const agent = new CapturingAgent({ add: "def add (a: Int) (b: Int) -> Int = a + b" });
  await work(queue, agent, { root, workerId: "w1", maxIdlePolls: 1, pollMs: 0 });

  assert.equal(agent.contexts.length, 1);
  const notes = agent.contexts[0].notes ?? [];
  assert.ok(notes.some((n) => n.body.includes("never introduce Float")), "the convention reached the agent");
  const prompt = buildPrompt(agent.contexts[0]);
  assert.match(prompt, /never introduce Float/);
  assert.match(prompt, /convention/i);
});

test("an agent's `# assume:` line lands as a first-class assumption note", async () => {
  const root = fresh();
  const queue = new FileQueue(join(root, ".strand-swarm"));
  queue.add({ title: "code solve", role: "code", intent: "a solver", target: ["solve"], deps: [] });
  const agent = new CapturingAgent({
    solve: "# assume: task said 'a solver'; chose the closed form over search\ndef solve (n: Int) -> Int = n * 2",
  });
  const summary = await work(queue, agent, { root, workerId: "w1", maxIdlePolls: 1, pollMs: 0 });

  assert.equal(summary.done.length, 1);
  const repo = loadRepo(root);
  const notes = [...repo.memory.values()];
  const assumption = notes.find((n) => n.type === "assumption");
  assert.ok(assumption, "the assumption was recorded instead of asked");
  assert.match(assumption!.body, /closed form over search/);
  assert.ok(assumption!.targets.includes("solve"), "attached to the definition it governs");
  assert.equal(assumption!.by, "w1");
});

test("a worker steers away from a hot name another agent is actively on", async () => {
  const root = fresh();
  // `valid` is hot: three definitions depend on it (fan-in 3)
  author(root, "seed", "def valid (n: Int) -> Bool = n > 0");
  author(root, "seed", "def rowOk (n: Int) -> Bool = valid n");
  author(root, "seed", "def colOk (n: Int) -> Bool = valid n");
  author(root, "seed", "def boxOk (n: Int) -> Bool = valid n");

  // another agent has a live soft claim on it
  const repo = loadRepo(root);
  const now = repo.history.length;
  repo.hints = announce(repo.hints, "valid", "other-agent", now, now + 100);
  saveRepo(root, repo);

  const queue = new FileQueue(join(root, ".strand-swarm"));
  queue.add({ title: "rewrite valid", role: "code", intent: "v2", target: ["valid"], deps: [] });
  const agent = new CapturingAgent({ valid: "def valid (n: Int) -> Bool = n >= 1" });
  const summary = await work(queue, agent, { root, workerId: "w2", maxIdlePolls: 1, pollMs: 0, maxAttempts: 2 });

  assert.equal(agent.contexts.length, 0, "the agent never ran — the worker steered away");
  assert.equal(summary.done.length, 0);
  assert.ok(queue.list().every((t) => t.state !== "done"));
});

test("a worker announces its own intent on a hot name before working it", async () => {
  const root = fresh();
  author(root, "seed", "def valid (n: Int) -> Bool = n > 0");
  author(root, "seed", "def rowOk (n: Int) -> Bool = valid n");
  author(root, "seed", "def colOk (n: Int) -> Bool = valid n");
  author(root, "seed", "def boxOk (n: Int) -> Bool = valid n");

  const queue = new FileQueue(join(root, ".strand-swarm"));
  queue.add({ title: "rewrite valid", role: "code", intent: "v2", target: ["valid"], deps: [] });
  const agent = new CapturingAgent({ valid: "def valid (n: Int) -> Bool = n >= 1" });
  const summary = await work(queue, agent, { root, workerId: "w1", maxIdlePolls: 1, pollMs: 0 });

  assert.equal(summary.done.length, 1, "nobody else is on it — optimistic, proceed");
  const repo = loadRepo(root);
  const mine = [...repo.hints.values()].filter((i) => i.agent === "w1" && i.name === "valid");
  assert.ok(mine.length > 0, "the soft claim was announced (and gossips to peers)");
});

test("cold names skip the hint machinery entirely (pure optimism)", async () => {
  const root = fresh();
  const repo = loadRepo(root);
  // someone claims `add`, but `add` is cold (fan-in 0) — hints must not block
  repo.hints = announce(repo.hints, "add", "other-agent", 0, 100);
  saveRepo(root, repo);

  const queue = new FileQueue(join(root, ".strand-swarm"));
  queue.add({ title: "code add", role: "code", intent: "adder", target: ["add"], deps: [] });
  const agent = new CapturingAgent({ add: "def add (a: Int) (b: Int) -> Int = a + b" });
  const summary = await work(queue, agent, { root, workerId: "w1", maxIdlePolls: 1, pollMs: 0 });

  assert.equal(summary.done.length, 1, "a cold name is claimed optimistically");
});
