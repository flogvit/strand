import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentFor } from "../src/swarm/adapter.ts";
import { FileQueue, type Queue, type ReportUpdate, type Task, type TaskSpec } from "../src/swarm/queue.ts";
import { work } from "../src/swarm/worker.ts";
import type { Agent, AgentContext, AgentResult } from "../src/swarm/adapter.ts";

/** #31 — validate a real LLM provider end-to-end: a live worker drives a small
 *  seeded dependency graph through the green-gate with an actual model
 *  authoring the Strand. Measures what the milestone flagged as the honest
 *  untested risk: how often the gate rejects, how many retries to green,
 *  whether parking stays rare.
 *
 *    npx tsx scripts/validate-llm.ts [claude|codex|gemini]
 */

const provider = process.argv[2] ?? "claude";
const CLI = join(process.cwd(), "src", "cli.ts");

function strand(root: string, args: string[]): string {
  return execFileSync("npx", ["tsx", CLI, ...args], {
    env: { ...process.env, STRAND_ROOT: root },
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
}

/** Wrap the agent to count model invocations and capture outputs. */
class Instrumented implements Agent {
  readonly provider: string;
  runs: { target: string[]; code: string }[] = [];
  constructor(private readonly inner: Agent) {
    this.provider = inner.provider;
  }
  run(ctx: AgentContext): AgentResult {
    const result = this.inner.run(ctx);
    this.runs.push({ target: ctx.task.target, code: result.code });
    return result;
  }
}

/** Wrap the queue to capture every report (the gate verdicts live in comments). */
class Observed implements Queue {
  reports: { id: string; state: string; comment?: string }[] = [];
  constructor(private readonly inner: Queue) {}
  add(spec: TaskSpec): Task {
    return this.inner.add(spec);
  }
  list(): Task[] {
    return this.inner.list();
  }
  get(id: string): Task | undefined {
    return this.inner.get(id);
  }
  claim(workerId: string): Task | undefined {
    return this.inner.claim(workerId);
  }
  report(id: string, update: ReportUpdate): void {
    this.reports.push({ id, state: update.state, comment: update.comment });
    this.inner.report(id, update);
  }
}

const root = mkdtempSync(join(tmpdir(), `strand-validate-${provider}-`));
strand(root, ["init"]);

const queue = new Observed(new FileQueue(join(root, ".strand-swarm")));
const t1 = queue.add({ title: "code add: integer addition", role: "code", intent: "add two Ints", target: ["add"], deps: [] });
const t2 = queue.add({ title: "code double: double a number", role: "code", intent: "double an Int using add", target: ["double"], deps: [t1.id] });
const t3 = queue.add({
  title: "code fact: factorial",
  role: "code",
  intent: "recursive factorial of an Int (fact 0 = 1)",
  target: ["fact"],
  deps: [],
});
const t4 = queue.add({ title: "test double and fact", role: "test", intent: "verify double and fact", target: ["double", "fact"], deps: [t2.id, t3.id] });

const agent = new Instrumented(agentFor(provider));
console.log(`validating provider '${provider}' against a ${queue.list().length}-task graph in ${root}\n`);

const started = Date.now();
const summary = await work(queue, agent, { root, workerId: provider, maxIdlePolls: 2, pollMs: 200, maxAttempts: 3 });
const secs = ((Date.now() - started) / 1000).toFixed(1);

const rejections = queue.reports.filter((r) => r.comment?.includes("green-gate rejected"));
const noLand = queue.reports.filter((r) => r.comment?.includes("did not land"));
const parkedFinal = queue.list().filter((t) => t.state === "parked");

console.log(`\n=== ${provider} validation ===`);
console.log(`model invocations : ${agent.runs.length}`);
console.log(`tasks done        : ${summary.done.length}/${queue.list().length}`);
console.log(`gate rejections   : ${rejections.length}`);
for (const r of rejections) console.log(`   task ${r.id}: ${r.comment}`);
console.log(`name-park retries : ${noLand.length}`);
console.log(`parked at exit    : ${parkedFinal.length} ${parkedFinal.map((t) => t.title).join("; ")}`);
console.log(`wall clock        : ${secs}s`);

const probe = (label: string, args: string[]): void => {
  try {
    console.log(`${label}${strand(root, args).trim()}`);
  } catch (e) {
    console.log(`${label}FAILED — ${(e as Error).message.split("\n")[0]}`);
  }
};
probe("\nnamespace:\n", ["ls"]);
probe("strand test:\n", ["test"]);
probe("eval double 21 = ", ["eval", "double 21"]);
probe("eval fact 5    = ", ["eval", "fact 5"]);
