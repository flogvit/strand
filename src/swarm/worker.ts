import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { gossipOnce } from "../distributed/transport.ts";
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

/** Run one task through the full loop. Returns the state to report back. */
function attempt(root: string, workerId: string, agent: Agent, task: Task): {
  state: "done" | "ready";
  comment: string;
} {
  const namespaceSource = (() => {
    try {
      return strand(root, ["export"]);
    } catch {
      return "";
    }
  })();

  const result = agent.run({ task, namespaceSource });
  if (!result.code.trim()) return { state: "ready", comment: "empty agent output" };

  const file = join(mkdtempSync(join(tmpdir(), "strand-work-")), "work.strand");
  writeFileSync(file, result.code);

  try {
    strand(root, ["submit", "--as", workerId, "--intent", task.intent, "--file", file]);
    strand(root, ["merge"]);
  } catch (e) {
    // The green-gate rejected it — park for a retry, don't corrupt the store.
    return { state: "ready", comment: `green-gate rejected: ${(e as Error).message.split("\n")[0]}` };
  }

  if (!landed(root, defNames(result.code))) {
    return { state: "ready", comment: "submitted but a definition did not land (likely parked as a name conflict)" };
  }
  return { state: "done", comment: result.report };
}

export async function work(queue: Queue, agent: Agent, opts: WorkerOptions): Promise<WorkSummary> {
  const { root, workerId, maxIdlePolls = 3, pollMs = 100, peers = [], maxAttempts = 3 } = opts;
  const summary: WorkSummary = { workerId, done: [], parked: [] };
  const attempts = new Map<string, number>();
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

    let outcome: { state: "done" | "ready"; comment: string };
    try {
      outcome = attempt(root, workerId, agent, task);
    } catch (e) {
      outcome = { state: "ready", comment: `worker error: ${(e as Error).message.split("\n")[0]}` };
    }

    if (outcome.state === "done") {
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
