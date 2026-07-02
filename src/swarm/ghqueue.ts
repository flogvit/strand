import { execFileSync } from "node:child_process";
import type { Queue, ReportUpdate, Role, Task, TaskSpec, TaskState } from "./queue.ts";

/** GitHub-issues backend for the task queue — the genuinely shared, add-while-
 *  running coordination point. Agents on any machine pull from the same board a
 *  human can post to mid-run. The queue stays dumb and robust: an issue per
 *  task, labels for role/state, the body for intent/targets/deps.
 *
 *  Claims are `claimed-by:<worker>` labels, not assignees — a single-operator
 *  swarm has one GitHub login for many workers, so assignment cannot identify
 *  a worker (#37 found this live). GitHub offers no compare-and-swap, so
 *  `claim` is optimistic with verification: add your label, re-read, and if a
 *  race left several claim labels the lexicographically-first worker wins —
 *  everyone computes the same winner, losers withdraw. Claim freshness rides
 *  on the issue's own `updatedAt` (every claim, report and comment bumps it),
 *  so a crashed worker's claim goes stale and is reclaimable after the TTL
 *  without a timestamp label per claim polluting the label namespace. */

const TASK_LABEL = "strand-task";
const CLAIM_PREFIX = "claimed-by:";
const DEFAULT_CLAIM_TTL_MS = 15 * 60 * 1000;

/** Run one `gh` invocation (args exclude the `gh` itself) and return stdout.
 *  Injectable so tests can stand in a fake GitHub. */
export type GhRunner = (args: string[]) => string;

export interface GhQueueOptions {
  /** owner/repo the issues live in. */
  repo: string;
  runner?: GhRunner;
  now?: () => number;
  claimTtlMs?: number;
}

interface GhIssue {
  number: number;
  title: string;
  body: string;
  labels: { name: string }[];
  state: string;
  updatedAt: string;
}

function realRunner(repo: string): GhRunner {
  return (args) =>
    execFileSync("gh", [...args, "--repo", repo], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
}

function bodyOf(spec: TaskSpec): string {
  const lines = [`intent: ${spec.intent}`, `target: ${spec.target.join(",")}`, `deps: ${spec.deps.join(",")}`];
  if (spec.helperPrefix) lines.push(`prefix: ${spec.helperPrefix}`);
  if (spec.require?.length) lines.push(`require: ${spec.require.join(",")}`);
  return lines.join("\n");
}

function fieldOf(body: string, key: string): string {
  // [ \t] only: \s would eat the newline after an empty field and capture the
  // NEXT line as the value ("deps:\nprefix: x" -> deps ["prefix: x"]) — which
  // left every dep-free task permanently blocked (#37, found live).
  const m = body.match(new RegExp(`^${key}:[ \\t]*(.*)$`, "m"));
  return m ? m[1].trim() : "";
}

const csv = (s: string): string[] => (s ? s.split(",").map((x) => x.trim()).filter(Boolean) : []);

export class GhQueue implements Queue {
  private readonly runner: GhRunner;
  private readonly now: () => number;
  private readonly claimTtlMs: number;
  /** Labels confirmed to exist — `gh` rejects unknown labels, so each is
   *  created (idempotently) before first use. */
  private readonly knownLabels = new Set<string>();

  constructor(opts: GhQueueOptions) {
    this.runner = opts.runner ?? realRunner(opts.repo);
    this.now = opts.now ?? Date.now;
    this.claimTtlMs = opts.claimTtlMs ?? DEFAULT_CLAIM_TTL_MS;
  }

  private ensureLabel(name: string): void {
    if (this.knownLabels.has(name)) return;
    try {
      this.runner(["label", "create", name, "--force"]);
    } catch {
      // an existing label (or a race creating it) is exactly what we want
    }
    this.knownLabels.add(name);
  }

  /** One issue, read directly — strongly consistent, unlike the list. */
  private viewIssue(number: number): GhIssue {
    const out = this.runner([
      "issue", "view", String(number),
      "--json", "number,title,body,labels,state,updatedAt",
    ]);
    return JSON.parse(out) as GhIssue;
  }

  private issues(): GhIssue[] {
    const out = this.runner([
      "issue", "list",
      "--label", TASK_LABEL,
      "--state", "all",
      "--limit", "500",
      "--json", "number,title,body,labels,state,updatedAt",
    ]);
    return (JSON.parse(out) as GhIssue[]).sort((a, b) => a.number - b.number);
  }

  private claimants(issue: GhIssue): string[] {
    return issue.labels
      .map((l) => l.name)
      .filter((l) => l.startsWith(CLAIM_PREFIX))
      .map((l) => l.slice(CLAIM_PREFIX.length))
      .sort();
  }

  private toTask(issue: GhIssue): Task {
    const labels = issue.labels.map((l) => l.name);
    const state = (labels.find((l) => l.startsWith("state:"))?.slice(6) ?? "ready") as TaskState;
    const role = (labels.find((l) => l.startsWith("role:"))?.slice(5) ?? "code") as Role;
    return {
      id: String(issue.number),
      title: issue.title,
      role,
      intent: fieldOf(issue.body, "intent"),
      target: csv(fieldOf(issue.body, "target")),
      deps: csv(fieldOf(issue.body, "deps")),
      ...(fieldOf(issue.body, "prefix") ? { helperPrefix: fieldOf(issue.body, "prefix") } : {}),
      ...(csv(fieldOf(issue.body, "require")).length ? { require: csv(fieldOf(issue.body, "require")) } : {}),
      state,
      assignee: this.claimants(issue)[0] ?? null,
    };
  }

  /** A live claim blocks; a stale one (crashed worker — the issue has not been
   *  touched within the TTL) does not. */
  private claimIsLive(issue: GhIssue): boolean {
    if (this.claimants(issue).length === 0) return false;
    return this.now() - Date.parse(issue.updatedAt) <= this.claimTtlMs;
  }

  add(spec: TaskSpec): Task {
    const labels = [TASK_LABEL, `role:${spec.role}`, `state:${spec.state ?? "ready"}`];
    for (const l of labels) this.ensureLabel(l);
    const url = this.runner([
      "issue", "create",
      "--title", spec.title,
      "--body", bodyOf(spec),
      "--label", labels.join(","),
    ]);
    const number = Number(url.trim().split("/").pop());
    return {
      id: String(number),
      title: spec.title,
      role: spec.role,
      intent: spec.intent,
      target: spec.target,
      deps: spec.deps,
      ...(spec.helperPrefix ? { helperPrefix: spec.helperPrefix } : {}),
      ...(spec.require?.length ? { require: spec.require } : {}),
      state: spec.state ?? "ready",
      assignee: null,
    };
  }

  list(): Task[] {
    return this.issues().map((i) => this.toTask(i));
  }

  get(id: string): Task | undefined {
    return this.list().find((t) => t.id === id);
  }

  claim(workerId: string): Task | undefined {
    const issues = this.issues();
    const byId = new Map(issues.map((i) => [String(i.number), this.toTask(i)]));
    const doneDeps = (t: Task): boolean => t.deps.every((d) => byId.get(d)?.state === "done");

    for (const issue of issues) {
      const task = this.toTask(issue);
      if (task.state !== "ready" || !doneDeps(task)) continue;

      // The list endpoint is eventually consistent (#37, found live): it can
      // show a claim that was already withdrawn — or hide one just placed.
      // Decide liveness from a fresh single-issue read.
      const fresh = this.viewIssue(issue.number);
      const freshTask = this.toTask(fresh);
      if (freshTask.state !== "ready" || this.claimIsLive(fresh)) continue;

      // evict any stale claim, then claim optimistically
      this.ensureLabel(`${CLAIM_PREFIX}${workerId}`);
      const edit: string[] = ["issue", "edit", String(issue.number)];
      for (const c of this.claimants(fresh)) edit.push("--remove-label", `${CLAIM_PREFIX}${c}`);
      edit.push("--add-label", `${CLAIM_PREFIX}${workerId}`);
      this.runner(edit);

      // verify: a race leaves several claim labels; the sorted-first worker
      // wins everywhere, losers withdraw their own label. Read the single
      // issue — the list endpoint is eventually consistent and can still be
      // blind to the label we just added (#37, found live).
      const after = this.viewIssue(issue.number);
      const winner = this.claimants(after)[0];
      if (winner === workerId) return { ...task, assignee: workerId };
      this.runner(["issue", "edit", String(issue.number), "--remove-label", `${CLAIM_PREFIX}${workerId}`]);
    }
    return undefined;
  }

  report(id: string, update: ReportUpdate): void {
    const issue = this.issues().find((i) => i.number === Number(id));
    if (!issue) throw new Error(`no such task #${id}`);
    const labels = issue.labels.map((l) => l.name);
    const oldState = labels.find((l) => l.startsWith("state:"));

    this.ensureLabel(`state:${update.state}`);
    const edit: string[] = ["issue", "edit", String(issue.number)];
    if (oldState && oldState !== `state:${update.state}`) edit.push("--remove-label", oldState);
    edit.push("--add-label", `state:${update.state}`);
    if (update.unassign) {
      for (const c of this.claimants(issue)) edit.push("--remove-label", `${CLAIM_PREFIX}${c}`);
    }
    this.runner(edit);

    if (update.comment) {
      this.runner(["issue", "comment", String(issue.number), "--body", update.comment]);
    }
    if (update.state === "done") {
      this.runner(["issue", "close", String(issue.number)]);
    }
  }
}
