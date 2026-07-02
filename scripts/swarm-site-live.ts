import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { record } from "../src/distributed/memory.ts";
import { loadRepo, saveRepo } from "../src/persist.ts";
import { agentFor } from "../src/swarm/adapter.ts";
import { seed } from "../src/swarm/plan.ts";
import { FileQueue, type Queue, type ReportUpdate, type Task, type TaskSpec } from "../src/swarm/queue.ts";
import { SITE_CONVENTIONS, WEBSITE } from "../src/swarm/site.ts";
import { work } from "../src/swarm/worker.ts";
import type { Agent, AgentContext, AgentResult } from "../src/swarm/adapter.ts";

/** Build the Strand website with a live swarm: seed the WEBSITE decomposition
 *  (specs pinned, conventions recorded), drive it through the green-gate, then
 *  materialize site/ — index.html and styles.css evaluated from the swarm's
 *  own namespace, plus the transpiled Sudoku solver for the interactive demo.
 *
 *    npx tsx scripts/swarm-site-live.ts [claude|codex|gemini]
 */

const provider = process.argv[2] ?? "claude";
const MAX_ROUNDS = 40;
const GLOBAL_ATTEMPT_CAP = 5;
const CLI = join(process.cwd(), "src", "cli.ts");
const SITE = join(process.cwd(), "site");

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
    console.log(`  [model] ${ctx.task.id} ${ctx.task.title.slice(0, 60)}`);
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
    if (update.comment && update.state !== "done") console.log(`  [retry] task ${id}: ${update.comment.slice(0, 140)}`);
    this.inner.report(id, update);
  }
}

// ---- seed -------------------------------------------------------------------
const root = mkdtempSync(join(tmpdir(), `strand-site-${provider}-`));
strand(root, ["init"]);
strand(root, ["submit", "--as", "prelude", "--intent", "prelude", "--file", join(process.cwd(), "lib", "prelude.strand")]);
strand(root, ["merge"]);

{
  const repo = loadRepo(root);
  const allNames = WEBSITE.map((d) => d.name);
  for (const c of SITE_CONVENTIONS) {
    repo.memory = record(repo.memory, { type: "convention", subject: c.subject, body: c.body, by: "planner", targets: allNames });
  }
  saveRepo(root, repo);
}

const queue = new Observed(new FileQueue(join(root, ".strand-swarm")));
const tasks = seed(queue, WEBSITE, root);
const agent = new Instrumented(agentFor(provider));
console.log(`site swarm (${provider}): ${tasks.length} tasks in ${root}\n`);

// ---- drive ------------------------------------------------------------------
const started = Date.now();
let lastProgress = "";
for (let round = 1; round <= MAX_ROUNDS; round++) {
  const open = queue.list().filter((t) => t.state === "ready" || t.state === "blocked");
  if (open.length === 0) break;

  const progress = JSON.stringify([queue.list().map((t) => [t.id, t.state]), agent.invocations]);
  if (progress === lastProgress) {
    console.log(`round ${round}: stagnant (open tasks gated behind parked deps) — stopping`);
    break;
  }
  lastProgress = progress;

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

  for (const w of ["w1", "w2", "w3", "w4"]) {
    await work(queue, agent, { root, workerId: w, maxIdlePolls: 1, pollMs: 0, maxAttempts: 3 });
  }
  const by = (s: string) => queue.list().filter((t) => t.state === s).length;
  console.log(`round ${round}: done:${by("done")} ready:${by("ready")} blocked:${by("blocked")} parked:${by("parked")} — ${agent.invocations} model calls`);
}

const secs = ((Date.now() - started) / 1000).toFixed(0);
const rejections = queue.reports.filter((r) => r.comment?.includes("green-gate rejected"));
const final = queue.list();
console.log(`\n=== site swarm (${provider}) ===`);
console.log(`model invocations : ${agent.invocations}`);
console.log(`tasks done        : ${final.filter((t) => t.state === "done").length}/${final.length}`);
console.log(`gate rejections   : ${rejections.length}`);
console.log(`parked at exit    : ${final.filter((t) => t.state === "parked").map((t) => `#${t.id} ${t.title}`).join("; ") || "none"}`);
console.log(`wall clock        : ${secs}s`);

console.log(`\nstrand test:\n${strand(root, ["test"]).trim()}`);

// ---- materialize site/ ------------------------------------------------------
// Emit the swarm's namespace, strip eager tst_ leaves, and evaluate the page
// through the transpiled projection (same trusted path the oracle uses).
const dir = mkdtempSync(join(tmpdir(), "strand-site-build-"));
const emitted = join(dir, "namespace.ts");
strand(root, ["emit", "--out", emitted]);
writeFileSync(
  emitted,
  readFileSync(emitted, "utf8").split("\n").filter((l) => !l.startsWith("export const tst_")).join("\n"),
);
const driver = join(dir, "driver.ts");
writeFileSync(driver, `import { pageIndex, siteStyles } from "./namespace.ts";\nprocess.stdout.write(JSON.stringify({ pageIndex, siteStyles }));\n`);
const { pageIndex, siteStyles } = JSON.parse(
  execFileSync("npx", ["tsx", driver], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }),
) as { pageIndex: string; siteStyles: string };

mkdirSync(SITE, { recursive: true });
writeFileSync(join(SITE, "index.html"), pageIndex + "\n");
writeFileSync(join(SITE, "styles.css"), siteStyles + "\n");

// The demo runtime: the swarm-built solver (tests stripped), transpiled to
// browser-ready JS, plus the hand-written mount script.
const solverTs = readFileSync(join(process.cwd(), "examples", "out", "sudoku-swarm.ts"), "utf8")
  .split("\n")
  .filter((l) => !l.startsWith("export const tst_"))
  .join("\n");
const solverJs = ts.transpileModule(solverTs, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
}).outputText;
writeFileSync(join(SITE, "sudoku.js"), solverJs);
copyFileSync(join(process.cwd(), "scripts", "site-assets", "demo.js"), join(SITE, "demo.js"));

console.log(`\nsite written: site/index.html (${pageIndex.length} bytes), styles.css (${siteStyles.length} bytes), sudoku.js, demo.js`);
