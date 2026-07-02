# Running swarms

How to put real models to work on a Strand namespace: the moving parts, the
commands, and what the live runs measured.

## The model

Three planes, deliberately dumb where dumb is robust:

- **Task plane** — a shared queue. Tasks carry a role (`code`/`test`), an
  intent (the *why*, carried through to review), target definition names, and
  dependency edges. Workers claim whatever is ready whose deps are done
  (work-stealing); nothing assigns work top-down.
- **Work plane** — provider-agnostic workers. An "agent" is a command plus a
  prompt template (`src/swarm/adapter.ts`): `claude`, `codex`, `gemini`, or
  anything else that reads a prompt and prints a reply. Strand does not care
  who authored a definition — it is content-addressed.
- **Merge plane** — every result goes through the green-gate. A rejected
  submission never touches the store; the worker retries with the compiler's
  actual error in the prompt, then parks the task after its attempt budget.

## Quickstart

```bash
npm run strand -- init
npm run strand-swarm -- plan                       # seed the Sudoku decomposition
npm run strand-swarm -- work --as w1 --provider claude
npm run strand-swarm -- status
```

Options on `work`:

- `--gh owner/repo` — GitHub issues as the queue (see below).
- `--peers http://host:4100,http://host2:4100` — gossip with other machines
  before each poll, so definitions landed elsewhere are local before the agent
  runs.
- `--poll <ms> --idle <n>` — polling cadence and how many empty polls before
  the worker exits (raise these for multi-worker runs so a worker outwaits a
  dependency another worker is still building).

## Planning: decompositions, pinned contracts, conventions

A workload is a list of `DefSpec`s (`src/swarm/plan.ts`): name, intent,
dependency names, and optionally

- `spec` — a pinned contract (signature + behavior). Seeding records it as a
  `spec` note in decision memory; every agent whose task touches that name gets
  it in the prompt. This is what keeps 20 components calling `elA` with the
  same shape instead of five private conventions.
- `test: false` — skip the auto-generated test task, for definitions an
  external oracle verifies (don't make an agent fabricate a duplicate literal).

Conventions (HTML-safety rules, design tokens, voice) are recorded the same way
— see `SITE_CONVENTIONS` in `src/swarm/site.ts` for a real example. The
`strand partition` command (Kernighan–Lin min-cut) splits a dependency graph
into balanced low-contention slices and reports fan-in centrality — the hot
names the hint layer watches.

## Queues

- **FileQueue** — a JSON file guarded by an atomic mkdir lockfile. Local dev
  and tests.
- **GhQueue** (`src/swarm/ghqueue.ts`) — an issue per task: labels carry
  role/state, the body carries intent/targets/deps. GitHub has no
  compare-and-swap, so claiming is optimistic with verification: assign
  yourself, re-read, sorted-first assignee wins, losers withdraw. A claim
  carries a `claimed-at:<epoch>` label; a crashed worker's claim goes stale and
  is reclaimable after a TTL. Humans add tasks to the board while the swarm
  runs — that is the point.

## Multi-machine

Serve a repo to peers and let workers gossip:

```sh
npm run strand-swarm -- serve --port 4100 --host 0.0.0.0 --token <secret>
```

(or from code: `await servePeer(root, 4100, { token })`), then run workers
elsewhere with `--peers http://that-host:4100 --token <secret>`. The token
(defaulting to `$STRAND_SYNC_TOKEN` on both sides) authenticates every pull —
without one the transport is open and belongs on trusted networks only (see
SECURITY.md). Convergence is
by construction (store union + CRDT join); anti-entropy keeps the exchange
proportional to the diff. `test/swarm-multimachine.test.ts` is the executable
proof: worker B lands a definition that only typechecks because gossip pulled
worker A's work across first.

## What the live runs measured

All with a real `claude` model. Drivers in `scripts/`.

**Sudoku, 22 dependency-gated tasks** (`swarm-sudoku-live.ts`): 22/22 green,
one model call per task, zero gate rejections, 480 s. The solver was verified
against Wikipedia's puzzle by an oracle sharing zero code with the swarm
(`oracle-sudoku.ts`), through **both** execution engines (interpreter and
transpiled TS), which must agree cell for cell.

**Swarm economics** (`single-shot-sudoku.ts`, `parallel-swarm-sudoku.sh`): a
single agent solved the same graph in one call, 183 s — 2.6× faster than the
swarm; four parallel worker processes gained almost nothing (452 s) because the
graph's code phase is a chain and the critical path dominates. The swarm's
measured edge at this scale is coverage, not speed: 157 model-written tests
vs. the single agent's 39. Decomposition pays when the graph is wider than its
critical path or larger than one context window.

**The website** (`swarm-site-live.ts`): 26 definitions — HTML kit, components,
copy, CSS — with contracts pinned as spec notes and design/safety/voice
conventions in memory. 37/38 tasks green (the straggler was a test task), 42
model calls, 5 gate rejections all recovered by the error-feedback loop, 93
model-written kit tests green. `site/` is the evaluated output; the page's
interactive demo runs the swarm's own solver in the browser, and the whole
thing was verified visually in Chrome.

**Hard-won tuning lessons**, encoded in the code:

- The syntax primer in `buildPrompt` is what lets a model that has never seen
  Strand emit green code (the first live run died on `False` vs `false`).
- Feeding the gate's *actual* error into the retry prompt is the difference
  between convergence and burning attempts on the same mistake.
- Attempt budgets everywhere: per-worker (`maxAttempts`), plus a global cap and
  a stagnation cutoff in the drivers — a parked root dependency must never spin
  a loop or burn model calls forever.
- Heavy semantic verification belongs on the transpiled path or an external
  oracle; the tree-walking interpreter is the reference, not the workhorse.
