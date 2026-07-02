import { execFileSync } from "node:child_process";
import type { Queue, ReportUpdate, Role, Task, TaskSpec, TaskState } from "./queue.ts";

/** GitHub-issues backend for the task queue — the genuinely shared, add-while-
 *  running coordination point. Agents on any machine pull from the same board a
 *  human can post to mid-run. The queue stays dumb and robust: an issue per
 *  task, labels for role/state, the body for intent/targets/deps.
 *
 *  GitHub offers no compare-and-swap, so `claim` is optimistic with verification:
 *  assign yourself, re-read, and if a race left several assignees the
 *  lexicographically-first wins — everyone computes the same winner, losers
 *  withdraw. A claim carries a `claimed-at:<epoch-ms>` label; a crashed worker's
 *  claim simply goes stale and is reclaimable after the TTL, so nothing is ever
 *  stuck behind a dead machine. Worker ids double as GitHub logins in a real
 *  run (assignment requires a real user). */

const TASK_LABEL = "strand-task";
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
  assignees: { login: string }[];
  state: string;
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
  const m = body.match(new RegExp(`^${key}:\\s*(.*)$`, "m"));
  return m ? m[1].trim() : "";
}

const csv = (s: string): string[] => (s ? s.split(",").map((x) => x.trim()).filter(Boolean) : []);

export class GhQueue implements Queue {
  private readonly runner: GhRunner;
  private readonly now: () => number;
  private readonly claimTtlMs: number;

  constructor(opts: GhQueueOptions) {
    this.runner = opts.runner ?? realRunner(opts.repo);
    this.now = opts.now ?? Date.now;
    this.claimTtlMs = opts.claimTtlMs ?? DEFAULT_CLAIM_TTL_MS;
  }

  private issues(): GhIssue[] {
    const out = this.runner([
      "issue", "list",
      "--label", TASK_LABEL,
      "--state", "all",
      "--limit", "500",
      "--json", "number,title,body,labels,assignees,state",
    ]);
    return (JSON.parse(out) as GhIssue[]).sort((a, b) => a.number - b.number);
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
      assignee: issue.assignees[0]?.login ?? null,
    };
  }

  private claimedAt(issue: GhIssue): number | undefined {
    const l = issue.labels.map((x) => x.name).find((x) => x.startsWith("claimed-at:"));
    return l ? Number(l.slice("claimed-at:".length)) : undefined;
  }

  /** A live claim blocks; a stale one (crashed worker) does not. */
  private claimIsLive(issue: GhIssue): boolean {
    if (issue.assignees.length === 0) return false;
    const at = this.claimedAt(issue);
    return at === undefined || this.now() - at <= this.claimTtlMs;
  }

  add(spec: TaskSpec): Task {
    const labels = [TASK_LABEL, `role:${spec.role}`, `state:${spec.state ?? "ready"}`];
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
      if (task.state !== "ready" || this.claimIsLive(issue) || !doneDeps(task)) continue;

      // evict a stale claim, then claim optimistically
      const edit: string[] = ["issue", "edit", String(issue.number)];
      for (const a of issue.assignees) edit.push("--remove-assignee", a.login);
      const oldStamp = issue.labels.map((l) => l.name).find((l) => l.startsWith("claimed-at:"));
      if (oldStamp) edit.push("--remove-label", oldStamp);
      edit.push("--add-assignee", workerId, "--add-label", `claimed-at:${this.now()}`);
      this.runner(edit);

      // verify: races leave several assignees; the sorted-first wins everywhere
      const after = this.issues().find((i) => i.number === issue.number)!;
      const winner = after.assignees.map((a) => a.login).sort()[0];
      if (winner === workerId) return { ...task, assignee: workerId };
      this.runner(["issue", "edit", String(issue.number), "--remove-assignee", workerId]);
    }
    return undefined;
  }

  report(id: string, update: ReportUpdate): void {
    const issue = this.issues().find((i) => i.number === Number(id));
    if (!issue) throw new Error(`no such task #${id}`);
    const labels = issue.labels.map((l) => l.name);
    const oldState = labels.find((l) => l.startsWith("state:"));

    const edit: string[] = ["issue", "edit", String(issue.number)];
    if (oldState) edit.push("--remove-label", oldState);
    edit.push("--add-label", `state:${update.state}`);
    if (update.unassign) {
      for (const a of issue.assignees) edit.push("--remove-assignee", a.login);
      const stamp = labels.find((l) => l.startsWith("claimed-at:"));
      if (stamp) edit.push("--remove-label", stamp);
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
