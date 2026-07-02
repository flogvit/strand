import { record } from "../distributed/memory.ts";
import { loadRepo, saveRepo } from "../persist.ts";
import type { Queue, Task } from "./queue.ts";

/** The planner — the one genuinely agentic role, here seeded with a hand-written
 *  decomposition of the first workload. It turns a top-level goal into a dependency
 *  graph of small, independently testable tasks, so many workers can proceed in
 *  parallel and only genuinely-dependent work is serialized. Later this graph is
 *  what `strand partition` (#25) load-balances across agents. */

export interface DefSpec {
  /** The Strand definition this unit produces. */
  name: string;
  intent: string;
  /** Other definition names this one references. */
  deps: string[];
  /** Pinned contract (signature + behavior) — recorded as a spec note in the
   *  swarm's decision memory so every agent building on this name sees the
   *  same API instead of inventing its own. */
  spec?: string;
  /** Set false to skip the test task — for defs an external oracle verifies
   *  (a fabricated duplicate-literal test would add nothing). Default true. */
  test?: boolean;
  /** Helper namespace for this task (#52). When set, the worker mechanically
   *  rejects any def that is not the target and not carrying this prefix,
   *  so helper names are namespaced by construction, not prompt discipline. */
  helperPrefix?: string;
}

/** Sudoku generator, decomposed. A wide graph — plenty of parallelism for ≥10 agents. */
export const SUDOKU: DefSpec[] = [
  { name: "Grid", intent: "9x9 board model + cell access", deps: [] },
  { name: "rowOk", intent: "a value is legal in its row", deps: ["Grid"] },
  { name: "colOk", intent: "a value is legal in its column", deps: ["Grid"] },
  { name: "boxOk", intent: "a value is legal in its 3x3 box", deps: ["Grid"] },
  { name: "valid", intent: "a placement is legal (row & col & box)", deps: ["rowOk", "colOk", "boxOk"] },
  { name: "solve", intent: "backtracking solver", deps: ["valid"] },
  { name: "countSolutions", intent: "count solutions (bounded)", deps: ["valid"] },
  { name: "isUnique", intent: "exactly one solution", deps: ["countSolutions"] },
  { name: "fullBoard", intent: "a complete valid board", deps: ["solve"] },
  { name: "dig", intent: "remove cells while preserving uniqueness, by difficulty", deps: ["fullBoard", "isUnique"] },
  { name: "generate", intent: "driver: full board -> dug puzzle", deps: ["dig"] },
];

/** The helper-naming convention pinned into every decomposition (#52): agents
 *  invent helper defs the planner never named, and at swarm width two agents
 *  independently writing `go` or `aux` is a certainty — every collision parks
 *  a name no one semantically contends over. Prefixing helpers with their
 *  parent's name namespaces them by convention. */
export const HELPER_NAMING =
  "Helper definitions you invent must be prefixed with the definition they serve: " +
  "for a task targeting `solve`, write `solveTry`, `solveStep` — never bare `go`, `aux`, `loop`, `step`. " +
  "Another agent inventing the same bare name would force a needless conflict.";

/** Seed a decomposition into the queue: one `code` task per definition, plus one
 *  `test` task per definition that depends on its code task. Dependency edges are
 *  resolved from definition names to the queue ids they were assigned.
 *
 *  With a `root`, pinned specs land as spec notes in the repo's decision memory
 *  before any worker runs — the contract plane the agents author against — and
 *  the helper-naming convention (#52) is pinned across all seeded names. */
export function seed(queue: Queue, defs: DefSpec[] = SUDOKU, root?: string): Task[] {
  if (root) {
    const repo = loadRepo(root);
    for (const d of defs) {
      if (!d.spec) continue;
      repo.memory = record(repo.memory, {
        type: "spec",
        subject: d.name,
        body: d.spec,
        by: "planner",
        targets: [d.name],
      });
    }
    repo.memory = record(repo.memory, {
      type: "convention",
      subject: "helper naming",
      body: HELPER_NAMING,
      by: "planner",
      targets: defs.map((d) => d.name),
    });
    saveRepo(root, repo);
  }
  return seedTasks(queue, defs);
}

function seedTasks(queue: Queue, defs: DefSpec[]): Task[] {
  const codeIdByName = new Map<string, string>();
  const created: Task[] = [];

  for (const d of defs) {
    const task = queue.add({
      title: `code ${d.name}: ${d.intent}`,
      role: "code",
      intent: d.intent,
      target: [d.name],
      ...(d.helperPrefix ? { helperPrefix: d.helperPrefix } : {}),
      deps: d.deps.map((n) => {
        const id = codeIdByName.get(n);
        if (!id) throw new Error(`'${d.name}' depends on '${n}', which is not defined earlier`);
        return id;
      }),
    });
    codeIdByName.set(d.name, task.id);
    created.push(task);
  }

  for (const d of defs) {
    if (d.test === false) continue;
    created.push(
      queue.add({
        title: `test ${d.name}`,
        role: "test",
        intent: `verify ${d.name}`,
        target: [d.name],
        ...(d.helperPrefix ? { helperPrefix: d.helperPrefix } : {}),
        deps: [codeIdByName.get(d.name)!],
      }),
    );
  }

  return created;
}
