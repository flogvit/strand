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

## Watching a run

`strand-swarm dashboard --port 4200 [--peers http://a:4100,...] [--queue <dir> | --gh <owner/repo>]`
starts a read-only observer: it gossips like any peer (so it sees what the
swarm sees) but never submits, merges, claims or announces — losing it loses
nothing. The page it serves has four views: **nodes** (worker presence
heartbeats: provider, current task, done/parked, liveness by logical TTL),
**tasks** (the queue as a dependency DAG, layered by depth, with the frontier
marked and parked tasks showing the gate's actual complaint), **memory**
(decision memory grouped by type, assumptions first — the standing review
queue — with supersede history and target filtering), and **namespace** (every
resolved binding with type, source and TS projection, parked conflicts
side-by-side, live-intent hints, and a Merkle convergence strip per peer).

## Multi-machine

Serve a repo to peers and let workers gossip:

```sh
npm run strand-swarm -- serve --port 4100 --host 0.0.0.0 --token <secret>
```

(or from code: `await servePeer(root, 4100, { token })`), then run workers
elsewhere with `--peers http://that-host:4100 --token <secret>`. The token
(defaulting to `$STRAND_SYNC_TOKEN` on both sides) authenticates every pull —
without one the transport is open and belongs on trusted networks only (see
SECURITY.md).

### Two-machine runbook (#38)

One green namespace across two boxes, with GitHub as the shared task board
and HTTP gossip as the sync plane:

1. **Both machines**: clone the repo, `npm install`, log in `gh`, and export
   the same `STRAND_SYNC_TOKEN`. Each machine gets its own local store:
   `STRAND_ROOT=~/swarm-a npx tsx src/cli.ts init` (then submit + merge
   `lib/prelude.strand`).
2. **Machine A**: serve the store and start a worker:
   `npx tsx src/swarm/cli.ts serve --root ~/swarm-a --port 4100 --host 0.0.0.0 &`
   `npx tsx src/swarm/cli.ts work --as a1 --provider claude --root ~/swarm-a --gh <owner/repo> --peers http://B:4100 --poll 5000 --idle 24`
3. **Machine B**: mirror it, pointing at A:
   `npx tsx src/swarm/cli.ts serve --root ~/swarm-b --port 4100 --host 0.0.0.0 &`
   `npx tsx src/swarm/cli.ts work --as b1 --provider claude --root ~/swarm-b --gh <owner/repo> --peers http://A:4100 --poll 5000 --idle 24`
4. **Seed** the graph from either machine:
   `npx tsx src/swarm/cli.ts plan --stdlib --root ~/swarm-a --gh <owner/repo>`
5. **Watch** from anywhere:
   `npx tsx src/swarm/cli.ts dashboard --root ~/observer --gh <owner/repo> --peers http://A:4100,http://B:4100`
   — the namespace tab's convergence strip shows both Merkle roots against
   the observer's; three matching digests = one green namespace.

Executed live (2026-07-02, `scripts/swarm-two-peer-live.sh`): two peers —
separate stores, separate serve+worker processes, token-authenticated HTTP
gossip, GitHub as the shared board (issues #57/#58), a real `claude`
authoring. Peer A landed `chainBase`; peer B's `chainDouble` only
type-checked because gossip had pulled A's definition across first. Final
Merkle roots identical (one green namespace), both peers evaluate
`chainDouble` to 42. The two processes stood in for the two boxes on one
host — every byte between them crossed the authenticated HTTP transport and
the public board; putting real distance between them is this runbook,
verbatim.

Behavior under failure: a machine dropping mid-run costs nothing —
its claims go stale on the board (TTL on the issue's updatedAt) and are
reclaimed; gossip skips dead peers; when it returns, one anti-entropy round
pulls exactly the Merkle diff. Behind NAT, only reachability suffers: a peer
that cannot be dialed still pulls (the transport is pull-only and symmetric,
so one reachable direction is enough for convergence — it is just slower). Convergence is
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

**Stdlib, the wide-graph measurement** (`swarm-stdlib-live.sh`, #36): the
first workload wider than its critical path — 58 definitions seeded with
pinned contracts (113 tasks, width 41, critical path 3). Eight parallel
`claude` worker processes drained it in **485 s wall clock** against a
**2456 s serial cost** (Σ measured per-task seconds): a **5.1× speedup**,
comfortably past the "parallel ≲ ¼ of serial" success bar — decomposition
pays in wall clock once the graph is wide, exactly where Sudoku's chain
could not. 113/113 tasks green, **804 model-written tests pass**, `strand
untested` is empty, zero parked conflicts (the helper-prefix namespacing of
#52 held at width 8). The run also caught two real defects live: a torn
JSON read under eight concurrent writers crashed one worker (persistence is
now atomic write-and-rename, and a presence heartbeat can no longer take a
worker down), and the crashed worker's FileQueue claim had to be handed back
by hand — the TTL-eviction that GhQueue has is a known FileQueue gap.

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
