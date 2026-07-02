import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { depsOf } from "../core/term.ts";
import { announce, shouldAvoid, shouldConsult } from "../distributed/hints.ts";
import { forTarget, record, type Note } from "../distributed/memory.ts";
import { gossipOnce } from "../distributed/transport.ts";
import { loadRepo, saveRepo, type RepoState } from "../persist.ts";
import type { Agent } from "./adapter.ts";
import type { Queue, Task } from "./queue.ts";

/** The work plane. A worker pulls a ready task, hands it to a provider-agnostic
 *  agent, and pushes the result through the Strand green-gate. Correctness is the
 *  gate's job, not the agent's: anything that does not type-check is rejected and
 *  the task is parked for a retry, so a bad agent output can never corrupt the store. */

const CLI = join(process.cwd(), "src", "cli.ts");

export interface WorkerOptions {
  root: string;
  workerId: string;
  /** Stop after this many consecutive empty polls (the queue is drained). */
  maxIdlePolls?: number;
  /** Milliseconds to wait between polls. */
  pollMs?: number;
  /** Known peers (base URLs) to gossip with before each poll — the sync plane
   *  under the loop, so work on other machines flows in as it lands. */
  peers?: string[];
  /** Attempts on the same task before this worker parks it for someone else. */
  maxAttempts?: number;
}

export interface WorkSummary {
  workerId: string;
  done: string[];
  parked: string[];
}

function strand(root: string, args: string[]): string {
  return execFileSync("npx", ["tsx", CLI, ...args], {
    env: { ...process.env, STRAND_ROOT: root },
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
}

/** The definitions a chunk of Strand source declares (a task's target is an
 *  abstract label; what must actually land are the `def`s the agent wrote). */
function defNames(code: string): string[] {
  return [...code.matchAll(/^\s*def\s+([A-Za-z_]\w*)/gm)].map((m) => m[1]);
}

/** Assumptions the agent recorded instead of stopping to ask — `# assume: ...`
 *  comment lines inside the returned code block. */
function assumptionsOf(code: string): string[] {
  return [...code.matchAll(/^\s*#\s*assume:\s*(.+)$/gm)].map((m) => m[1].trim());
}

/** How many other definitions depend on `name` — the partitioner's fan-in
 *  centrality, computed against the live namespace. Hot names are the ones
 *  worth consulting hints for; a name not yet bound is cold by definition. */
function fanIn(repo: RepoState, name: string): number {
  const target = repo.namespace.get(name);
  if (!target) return 0;
  let n = 0;
  for (const [other, b] of repo.namespace) {
    if (other === name) continue;
    const def = repo.store.defOf(b.hash);
    if (def && depsOf(def.body).includes(target.hash)) n++;
  }
  return n;
}

/** Logical time for hints: the merge history length — monotone, shared via
 *  gossip, and no wall clock to disagree about across machines. */
const logicalNow = (repo: RepoState): number => repo.history.length;

const HINT_TTL = 10;

function landed(root: string, names: string[]): boolean {
  return names.every((name) => {
    try {
      strand(root, ["show", name]);
      return true;
    } catch {
      return false;
    }
  });
}

/** The gate's actual complaint — the subprocess stderr when present (that is
 *  where the compiler writes), else the exec error's first line. */
function gateError(e: unknown): string {
  const err = e as Error & { stderr?: string };
  const stderr = err.stderr?.trim();
  return stderr || err.message.split("\n")[0];
}

/** Run one task through the full loop. Returns the state to report back. */
function attempt(root: string, workerId: string, agent: Agent, task: Task, notes: Note[], feedback?: string): {
  state: "done" | "ready";
  comment: string;
  assumptions: string[];
} {
  const namespaceSource = (() => {
    try {
      return strand(root, ["export"]);
    } catch {
      return "";
    }
  })();

  const result = agent.run({ task, namespaceSource, notes, feedback });
  const assumptions = assumptionsOf(result.code);
  if (!result.code.trim()) return { state: "ready", comment: "empty agent output", assumptions };

  const file = join(mkdtempSync(join(tmpdir(), "strand-work-")), "work.strand");
  writeFileSync(file, result.code);

  try {
    strand(root, ["submit", "--as", workerId, "--intent", task.intent, "--file", file]);
    strand(root, ["merge"]);
  } catch (e) {
    // The green-gate rejected it — park for a retry, don't corrupt the store.
    return { state: "ready", comment: `green-gate rejected: ${gateError(e)}`, assumptions };
  }

  if (!landed(root, defNames(result.code))) {
    return { state: "ready", comment: "submitted but a definition did not land (likely parked as a name conflict)", assumptions };
  }
  return { state: "done", comment: result.report, assumptions };
}

export async function work(queue: Queue, agent: Agent, opts: WorkerOptions): Promise<WorkSummary> {
  const { root, workerId, maxIdlePolls = 3, pollMs = 100, peers = [], maxAttempts = 3 } = opts;
  const summary: WorkSummary = { workerId, done: [], parked: [] };
  const attempts = new Map<string, number>();
  const lastFailure = new Map<string, string>();
  let idle = 0;

  while (idle < maxIdlePolls) {
    // pull the sync plane first, so definitions landed on other machines are
    // in the local store before the agent (and the green-gate) run
    if (peers.length > 0) await gossipOnce(root, peers);

    const task = queue.claim(workerId);
    if (!task) {
      idle++;
      if (pollMs > 0) await delay(pollMs);
      continue;
    }
    idle = 0;
    const tries = (attempts.get(task.id) ?? 0) + 1;
    attempts.set(task.id, tries);

    // the coordination plane: steer around hot names another agent is actively
    // on (soft — never a lock), announce our own intent on hot targets, and
    // collect the decisions governing this work for the agent's prompt
    const repo = loadRepo(root);
    const now = logicalNow(repo);
    const busy = task.target.filter((t) => shouldAvoid(repo.hints, t, fanIn(repo, t), now, workerId));
    if (busy.length > 0) {
      const state = tries >= maxAttempts ? "parked" : "ready";
      queue.report(task.id, { state, unassign: true, comment: `steered away: ${busy.join(", ")} actively claimed elsewhere (soft hint)` });
      summary.parked.push(task.id);
      continue;
    }
    let announced = false;
    for (const t of task.target) {
      if (!shouldConsult(fanIn(repo, t))) continue;
      repo.hints = announce(repo.hints, t, workerId, now, now + HINT_TTL);
      announced = true;
    }
    if (announced) saveRepo(root, repo);
    const notes = [...new Map(
      [...task.target, task.id].flatMap((t) => forTarget(repo.memory, t)).map((n) => [n.id, n]),
    ).values()];

    let outcome: { state: "done" | "ready"; comment: string; assumptions: string[] };
    try {
      outcome = attempt(root, workerId, agent, task, notes, lastFailure.get(task.id));
    } catch (e) {
      outcome = { state: "ready", comment: `worker error: ${(e as Error).message.split("\n")[0]}`, assumptions: [] };
    }
    if (outcome.state !== "done") lastFailure.set(task.id, outcome.comment);

    if (outcome.state === "done") {
      // decisions the agent took under ambiguity become first-class memory —
      // recorded instead of asked, reviewable later on the narrative plane
      if (outcome.assumptions.length > 0) {
        const after = loadRepo(root);
        for (const a of outcome.assumptions) {
          after.memory = record(after.memory, {
            type: "assumption",
            subject: task.title,
            body: a,
            by: workerId,
            targets: [...task.target, task.id],
          });
        }
        saveRepo(root, after);
      }
      queue.report(task.id, { state: "done", comment: outcome.comment });
      summary.done.push(task.id);
    } else {
      // a task this worker keeps failing is parked (not ready) after the
      // attempt budget, so the loop can never spin forever on one bad task
      const state = tries >= maxAttempts ? "parked" : "ready";
      queue.report(task.id, { state, unassign: true, comment: outcome.comment });
      summary.parked.push(task.id);
    }
  }

  return summary;
}
