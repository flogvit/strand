# strand-swarm — autonomous provider-agnostic agent orchestration (first milestone: Sudoku generator)

Status: design, 2026-07-01. Author: brainstormed with Vegard.

## Goal

The Strand language solves *joining* parallel work (conflict-free content-addressed merge, no git
pain, transpile to TS/other languages after). That is half the value. The other half — what makes it
usable — is an **overbygg that actually runs the agents**: give a "network" of agents a task, and it
is decomposed, distributed, and done autonomously across many machines. This milestone builds the
first, honest slice of that layer and proves it end-to-end by generating a Sudoku generator.

## Non-negotiable properties (north star)

- **Provider-agnostic.** "Agent" is abstract. Under it: Claude, Codex, Gemini — the user chooses.
  Strand does not care who wrote a definition (content-addressed).
- **Autonomous + distributed.** Workers run without a human in the loop; new work can be added while
  it runs and is picked up automatically.
- **Coordinator-free correctness.** No custom lock server / leader election. Correctness rests on the
  Strand green-gate + CRDT merge; the task queue is a dumb, robust, already-existing coordinator.

## Architecture — three planes

### 1. Task plane — GitHub issues as the shared queue
- An issue = a unit of work. Adding work = opening an issue (satisfies "add tasks while it runs").
- Labels encode **role** (`role:plan`, `role:code`, `role:test`) and **state**
  (`ready`, `blocked`, `parked`, `done`).
- Body carries structured metadata: intent, target Strand name(s), dependency issue numbers.
- Claiming = atomic GitHub assignment (assignee = worker id). A worker only claims `ready`,
  unassigned issues whose dependencies are `done`. This is work-stealing; no central scheduler.

### 2. Work plane — the worker daemon
Per machine, a `strand-swarm work --as <id> --provider <p>` loop:
1. Poll the queue for a ready, unassigned, dependency-satisfied issue; assign it to self.
2. Build the task context: the issue + the current relevant Strand namespace (deps' signatures,
   the projection/TS emit so the agent sees real types).
3. Dispatch to the provider adapter → receive Strand definition(s) or tests.
4. `strand submit --as <id>` → green-gate. Then `strand merge`.
5. Green → comment result, label `done`, unblock dependents. Park/red → comment the diagnostic,
   label `parked`/reopen for a retry or a human.
6. Sync the store (local: shared `.strand/`; multi-machine later: #21/#23), take next.

Idempotent and crash-safe: a worker that dies mid-task leaves the issue assigned with a TTL; a
stale assignment is reclaimable. Nothing partial can corrupt the store — submit is all-or-nothing
through the gate.

### 3. Sync plane — the Strand substrate is shared memory
All agents author into the content-addressed store; merge + green-gate keep it green by construction.
Single-machine first (one `.strand/`). Multi-machine = the already-filed sync layer (#21), CRDT
merge (#22), anti-entropy (#23) — plugs in beneath the work plane without changing the loop.

## Roles = issue types + enforced mechanics (not "smart" agents)
- **Planner** (`role:plan`): the one genuinely agentic role. Takes a top-level task, decomposes it
  into `role:code`/`role:test` issues with dependency edges. Seeds difficulty via `strand partition`
  (#25) once a dep graph exists.
- **Coder** (`role:code`): claim → write Strand def(s) → submit.
- **Tester** (`role:test`): claim → write `strand test` attestations against a named def.
- **Integrator**: automatic. Green-gate + merge. Parks surface back as issues; no dedicated agent.

## Provider-agnostic adapter
A thin interface: `runAgent(task, context) -> { defs?, tests?, report }`. Implementations are CLI
wrappers per provider (`claude`, `codex`, `gemini`). v1 ships the **Claude** adapter (headless Claude
Code / SDK); others are added behind the same interface without touching the worker loop.

## First workload — Sudoku generator (the planner's seed output)
Decomposes to a natural, independently testable dependency graph (~10 defs):
`Grid` (9×9 model + cell access) → `rowOk` / `colOk` / `boxOk` → `valid` (legal placement) →
`solve` (backtracking) → `countSolutions` / `isUnique` → `fullBoard` (complete valid board) →
`dig` (remove cells preserving uniqueness, by difficulty) → `generate` (driver).
Each def gets a `strand test`. Enough parallel width for ≥10 agents.

## First slice — what we build now
1. Queue schema + a `strand-swarm` CLI: `plan` (seed issues from a task), `work` (the worker loop).
2. The adapter interface + Claude adapter.
3. Planner seeds the Sudoku issues.
4. Run a local pool of workers; they author the Sudoku defs + tests; green-gate assembles; verify
   `strand run generate` (or `strand-ts` equivalent) emits a valid, uniquely-solvable puzzle.
5. Single machine, multiple worker processes. Defer multi-machine sync to #21/#23.

## Explicitly deferred (already tracked)
Multi-machine sync (#21), CRDT-state merge (#22), anti-entropy (#23), advisory hints (#24),
graph-partition beyond components (#25), true peer-to-peer role negotiation (layered on the queue
later — the queue gives ~80% of the autonomous/distributed dream at a fraction of the risk).

## Success criterion
From a single top-level task ("build a Sudoku generator"), a pool of ≥10 provider-agnostic agents
autonomously pick up issues, author green Strand definitions + tests, and the assembled namespace
produces a working, uniqueness-checked Sudoku generator — with new issues added mid-run being picked
up and completed without human intervention.
