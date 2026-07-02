import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentFor } from "../src/swarm/adapter.ts";
import { seed } from "../src/swarm/plan.ts";
import { FileQueue, type Queue, type ReportUpdate, type Task, type TaskSpec } from "../src/swarm/queue.ts";
import { work } from "../src/swarm/worker.ts";
import type { Agent, AgentContext, AgentResult } from "../src/swarm/adapter.ts";

/** The live capstone: a swarm of real-LLM workers builds the full Sudoku
 *  decomposition (22 tasks, dependency-gated) through the green-gate — the
 *  scripted sudoku test, now with an actual model authoring the Strand.
 *
 *    npx tsx scripts/swarm-sudoku-live.ts [claude|codex|gemini]
 *
 *  Prints per-round progress and closing metrics: model invocations, gate
 *  rejections, retries, parks, wall clock — the honest cost of "real agents
 *  write green Strand" at dependency-graph scale. */

const provider = process.argv[2] ?? "claude";
const MAX_ROUNDS = 40;
/** Total gate rejections across all workers before a task is force-parked. */
const GLOBAL_ATTEMPT_CAP = 5;

const CLI = join(process.cwd(), "src", "cli.ts");

function strand(root: string, args: string[]): string {
  return execFileSync("npx", ["tsx", CLI, ...args], {
    env: { ...process.env, STRAND_ROOT: root },
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
}

class Instrumented implements Agent {
  readonly provider: string;
  invocations = 0;
  constructor(private readonly inner: Agent) {
    this.provider = inner.provider;
  }
  run(ctx: AgentContext): AgentResult {
    this.invocations++;
    console.log(`  [model] ${ctx.task.id} ${ctx.task.title}`);
    return this.inner.run(ctx);
  }
}

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
    if (update.comment && update.state !== "done") console.log(`  [retry] task ${id}: ${update.comment}`);
    this.inner.report(id, update);
  }
}

const root = mkdtempSync(join(tmpdir(), `strand-sudoku-${provider}-`));
strand(root, ["init"]);
strand(root, ["submit", "--as", "prelude", "--intent", "prelude", "--file", join(process.cwd(), "lib", "prelude.strand")]);
strand(root, ["merge"]);

const queue = new Observed(new FileQueue(join(root, ".strand-swarm")));
const tasks = seed(queue);
const agent = new Instrumented(agentFor(provider));
console.log(`live ${provider} swarm: ${tasks.length} tasks in ${root}\n`);

const workers = ["w1", "w2", "w3", "w4"];
const started = Date.now();

let lastProgress = "";
for (let round = 1; round <= MAX_ROUNDS; round++) {
  const open = queue.list().filter((t) => t.state === "ready" || t.state === "blocked");
  if (open.length === 0) break;

  // stagnation: nothing changed and no model call last round — every open task
  // is gated behind a parked dependency, so more rounds only burn time
  const progress = JSON.stringify([queue.list().map((t) => [t.id, t.state]), agent.invocations]);
  if (progress === lastProgress) {
    console.log(`round ${round}: stagnant (open tasks gated behind parked deps) — stopping`);
    break;
  }
  lastProgress = progress;

  // force-park a task the gate keeps rejecting, so it cannot burn model calls forever
  const rejectionsBy = new Map<string, number>();
  for (const r of queue.reports) {
    if (r.state === "ready" && r.comment) rejectionsBy.set(r.id, (rejectionsBy.get(r.id) ?? 0) + 1);
  }
  for (const t of open) {
    if ((rejectionsBy.get(t.id) ?? 0) >= GLOBAL_ATTEMPT_CAP && t.state === "ready") {
      queue.report(t.id, { state: "parked", unassign: true, comment: `parked: ${GLOBAL_ATTEMPT_CAP} rejected attempts` });
      console.log(`  [park ] task ${t.id} hit the global attempt cap`);
    }
  }

  for (const w of workers) {
    await work(queue, agent, { root, workerId: w, maxIdlePolls: 1, pollMs: 0, maxAttempts: 3 });
  }
  const by = (s: string) => queue.list().filter((t) => t.state === s).length;
  console.log(`round ${round}: done:${by("done")} ready:${by("ready")} blocked:${by("blocked")} parked:${by("parked")} — ${agent.invocations} model calls`);
}

const secs = ((Date.now() - started) / 1000).toFixed(0);
const rejections = queue.reports.filter((r) => r.comment?.includes("green-gate rejected"));
const noLand = queue.reports.filter((r) => r.comment?.includes("did not land"));
const final = queue.list();

console.log(`\n=== live ${provider} sudoku swarm ===`);
console.log(`model invocations : ${agent.invocations}`);
console.log(`tasks done        : ${final.filter((t) => t.state === "done").length}/${final.length}`);
console.log(`gate rejections   : ${rejections.length}`);
console.log(`name-park retries : ${noLand.length}`);
console.log(`parked at exit    : ${final.filter((t) => t.state === "parked").map((t) => `#${t.id} ${t.title}`).join("; ") || "none"}`);
console.log(`wall clock        : ${secs}s`);

const probe = (label: string, args: string[]): void => {
  try {
    console.log(`\n${label}\n${strand(root, args).trim()}`);
  } catch (e) {
    console.log(`\n${label} FAILED — ${(e as Error).message.split("\n")[0]}`);
  }
};
probe("strand test:", ["test"]);
probe("eval isUnique (generate 0 8):", ["eval", "isUnique (generate 0 8)"]);
probe("namespace:", ["ls"]);
