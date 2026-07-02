import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentFor, buildPrompt, type AgentContext } from "../src/swarm/adapter.ts";
import { SUDOKU } from "../src/swarm/plan.ts";
import type { Task } from "../src/swarm/queue.ts";

/** The 1-agent baseline for the swarm-economics comparison: ONE model call is
 *  asked for the entire Sudoku namespace (all 11 defs + their tests), submitted
 *  through the same green-gate. One retry with the gate's error, like a worker.
 *
 *    npx tsx scripts/single-shot-sudoku.ts [claude|codex|gemini]
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

const root = mkdtempSync(join(tmpdir(), `strand-singleshot-${provider}-`));
strand(root, ["init"]);
strand(root, ["submit", "--as", "prelude", "--intent", "prelude", "--file", join(process.cwd(), "lib", "prelude.strand")]);
strand(root, ["merge"]);

const task: Task = {
  id: "solo",
  title: "build the full Sudoku generator",
  role: "code",
  intent: SUDOKU.map((d) => `${d.name}: ${d.intent}`).join("; "),
  target: SUDOKU.map((d) => d.name),
  deps: [],
  state: "ready",
  assignee: null,
};

const agent = agentFor(provider);
const namespaceSource = strand(root, ["export"]);
console.log(`single-shot ${provider} baseline in ${root}\n`);

const started = Date.now();
let calls = 0;
let feedback: string | undefined;
let landed = false;

for (let attempt = 1; attempt <= 2 && !landed; attempt++) {
  const ctx: AgentContext = { task, namespaceSource, feedback };
  // one call is asked for everything the 22 swarm tasks produce, tests included
  const extra = `\nAlso write one zero-arg Bool test definition (name it tst_<def>) for EACH definition above, in the same code block.`;
  const prompt = buildPrompt(ctx) + extra;
  console.log(`[model] attempt ${attempt}`);
  calls++;
  const reply = execFileSync("claude", ["-p", prompt], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  const code = reply.match(/```(?:strand)?\s*\n([\s\S]*?)```/)?.[1] ?? reply;

  const file = join(root, "solo.strand");
  writeFileSync(file, code);
  try {
    strand(root, ["submit", "--as", "solo", "--intent", "single-shot sudoku", "--file", file]);
    strand(root, ["merge"]);
    landed = true;
  } catch (e) {
    const err = e as Error & { stderr?: string };
    feedback = err.stderr?.trim() || err.message.split("\n")[0];
    console.log(`[gate ] rejected: ${feedback}`);
  }
}

const secs = ((Date.now() - started) / 1000).toFixed(0);
console.log(`\n=== single-shot ${provider} ===`);
console.log(`model invocations : ${calls}`);
console.log(`landed green      : ${landed}`);
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
