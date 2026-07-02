import { existsSync, mkdirSync, readFileSync, rmdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The task plane. A shared work queue that ≥N provider-agnostic workers pull from
 *  autonomously: claim a ready task, do it, report, take the next. The queue is the
 *  coordinator — dumb and robust. Backends are pluggable (a local file for dev/tests,
 *  GitHub issues for the real distributed run) behind one interface, so the worker
 *  loop never changes when we swap where tasks live. */

export type Role = "plan" | "code" | "test";
export type TaskState = "ready" | "blocked" | "parked" | "done";

export interface Task {
  id: string;
  title: string;
  role: Role;
  /** Why — carried through to distillation and human review. */
  intent: string;
  /** Strand definition name(s) this task should produce or attest. */
  target: string[];
  /** Task ids that must be `done` before this one is claimable. */
  deps: string[];
  /** Planner-assigned helper namespace (#52): when set, every def this task
   *  produces must be the target or carry this prefix, enforced by the worker. */
  helperPrefix?: string;
  /** Checks to require on every definition this task lands (#51) — e.g.
   *  ["tests"], so `strand verify` becomes the workload's definition of done. */
  require?: string[];
  /** The most recent report comment — for a parked task, the actual reason
   *  (the green-gate's complaint), surfaced on the dashboard (#44). */
  lastComment?: string;
  state: TaskState;
  assignee: string | null;
}

export type TaskSpec = Omit<Task, "id" | "state" | "assignee"> & { state?: TaskState };

export interface ReportUpdate {
  state: TaskState;
  /** Frees the task for reclaim when moving off an in-progress state. */
  unassign?: boolean;
  comment?: string;
}

export interface Queue {
  add(spec: TaskSpec): Task;
  list(): Task[];
  get(id: string): Task | undefined;
  /** Atomically claim one ready, unassigned task whose deps are all done, or
   *  return undefined if none is available. Safe under concurrent workers. */
  claim(workerId: string): Task | undefined;
  report(id: string, update: ReportUpdate): void;
}

/** A task is workable iff it is ready, unclaimed, and every dependency is done. */
function claimable(task: Task, byId: Map<string, Task>): boolean {
  if (task.state !== "ready" || task.assignee !== null) return false;
  return task.deps.every((d) => byId.get(d)?.state === "done");
}

/** File-backed queue for local dev and tests. Cross-process safe via an atomic
 *  lockfile (mkdir is atomic) guarding every read-modify-write. */
export class FileQueue implements Queue {
  private readonly file: string;
  private readonly lockDir: string;

  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, "queue.json");
    this.lockDir = join(dir, ".lock");
    if (!existsSync(this.file)) writeFileSync(this.file, "[]\n");
  }

  private read(): Task[] {
    return JSON.parse(readFileSync(this.file, "utf8")) as Task[];
  }

  private write(tasks: Task[]): void {
    writeFileSync(this.file, JSON.stringify(tasks, null, 2) + "\n");
  }

  /** Run `fn` under the exclusive lock, retrying until the lock is free. */
  private locked<T>(fn: (tasks: Task[]) => { tasks?: Task[]; result: T }): T {
    for (let tries = 0; ; tries++) {
      try {
        mkdirSync(this.lockDir);
      } catch {
        if (tries > 10_000) throw new Error("queue lock timeout");
        continue;
      }
      try {
        const tasks = this.read();
        const { tasks: next, result } = fn(tasks);
        if (next) this.write(next);
        return result;
      } finally {
        rmdirSync(this.lockDir);
      }
    }
  }

  add(spec: TaskSpec): Task {
    return this.locked((tasks) => {
      const nextId = String(tasks.reduce((m, t) => Math.max(m, Number(t.id) || 0), 0) + 1);
      const task: Task = {
        id: nextId,
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
      return { tasks: [...tasks, task], result: task };
    });
  }

  list(): Task[] {
    return this.read();
  }

  get(id: string): Task | undefined {
    return this.read().find((t) => t.id === id);
  }

  claim(workerId: string): Task | undefined {
    return this.locked((tasks) => {
      const byId = new Map(tasks.map((t) => [t.id, t]));
      const pick = tasks.find((t) => claimable(t, byId));
      if (!pick) return { result: undefined };
      const next = tasks.map((t) => (t.id === pick.id ? { ...t, assignee: workerId } : t));
      return { tasks: next, result: { ...pick, assignee: workerId } };
    });
  }

  report(id: string, update: ReportUpdate): void {
    this.locked((tasks) => {
      const next = tasks.map((t) =>
        t.id === id
          ? {
              ...t,
              state: update.state,
              assignee: update.unassign ? null : t.assignee,
              ...(update.comment ? { lastComment: update.comment } : {}),
            }
          : t,
      );
      return { tasks: next, result: undefined };
    });
  }
}
