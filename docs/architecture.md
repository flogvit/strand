# Architecture

How Strand is put together, bottom-up: the substrate, the one merge algebra,
the sync plane, and the coordination layers on top. File pointers throughout —
the code is small and heavily commented; this is the map.

## The substrate

**Content-addressing** (`src/core/hash.ts`). A definition's identity is the
hash of its *structure*: parameters and body are alpha-normalized (names
replaced by depth-indexed placeholders) before hashing, so renaming a parameter
— or the definition itself — does not change identity. References inside a body
are the *hashes* of the definitions used, so identity is transitive: change a
dependency and every definition built on it gets a new identity too, while the
old versions remain valid forever. Mutually-recursive groups hash as a unit,
each member addressed as `<groupHash>.<index>`.

**The store** (`src/core/store.ts`) is append-only and content-addressed:
idempotent puts, nothing mutated or removed. Two peers that computed the same
definition landed on the same hash, so a store union is trivially convergent.
`isResolvable` is the green guard's cheap half: a hash whose dependencies are
all present.

**The green-gate** (`src/core/typecheck.ts`, `src/core/check.ts`). Submissions
compile against the current namespace (`compileProgram`); anything that does
not typecheck is rejected before it can bind a name. At merge,
`typecheckNamespace` re-checks the *whole* namespace, so a rebind that would
turn a green definition red is caught. A green merge attests `typecheck` for
every binding's content hash — attestations key on hashes, so they can never go
stale.

**Two execution engines.** The reference interpreter (`src/core/eval.ts`) and
the TypeScript emitter (`src/backend/emit_ts.ts`) must agree; the differential
oracle (`scripts/oracle-sudoku.ts`) drives swarm-authored code through both and
compares results cell for cell. Known limitation: zero-arg defs emit as eager
consts, so importing a projection executes them —
[#34](https://github.com/flogvit/strand/issues/34).

## One merge algebra: the namespace as a CRDT

`src/distributed/crdt.ts` — the namespace is a state-based CRDT (a
join-semilattice), so any number of machines converge with no coordinator:

- Per name, a grow-only set of **observations** (one per distinct content
  hash). Exactly one observed hash ⇒ the name is *resolved*; two or more ⇒
  *parked* — the same contention rule everywhere, now order-independent.
- A **resolution** settles a park by choosing a hash. It is itself a monotone
  add with a logical `seq`; the highest seq wins, ties broken by hash, so
  resolutions converge too.
- `join` is commutative, associative and idempotent; `view()` collapses the
  state to the resolved namespace plus its parked conflicts — the shape the
  gate, the projection and the human consume.

`src/repo.ts` is the repo-level merge *on* this algebra: pending transactions
become observations; a lone rebind supersedes the old binding via a resolution
one seq past the previous decision (an update is an ordinary step, not a
conflict with the past); two-or-more distinct hashes in the same round park.
The old batch merge (`src/merge.ts`) survives only as a thin adapter over the
same algebra, so local and distributed merges cannot disagree.

## Persistence

`src/persist.ts` — everything lives as JSON under `.strand/`: the store, the
resolved namespace (the human-readable view), pending transactions, conflicts,
attestations, history — and the distributed plane: `crdt.json`, `hints.json`,
`memory.json`. The CRDT state is the source of truth for contention; the
resolved namespace is derived from its view at merge/resolve. A repo written
before the distributed plane existed lifts its namespace and parked conflicts
into CRDT state on load, so legacy repos join the gossip unchanged.

## The sync plane

- **Snapshot/apply** (`src/distributed/sync.ts`): a peer's full state is plain
  JSON; applying is store-union + CRDT-join. Symmetric and order-independent.
- **Anti-entropy** (`src/distributed/merkle.ts`): each peer summarizes its hash
  set as a Merkle trie (FNV-1a digests, 16⁴ leaf buckets). Reconciliation
  descends only where digests differ — O(size of the diff), not O(size of the
  store). Content-addressing makes every digest stable; there is no
  invalidation bookkeeping.
- **Transport** (`src/distributed/transport.ts`): plain HTTP pull between known
  peers. A peer serves `GET /index` (its Merkle trie), `POST /objects` (objects
  by hash — only the diff crosses the wire) and `GET /state` (CRDT namespace +
  hints + memory, small enough to ship whole). `gossipOnce` pulls, reconciles,
  joins, saves. Pull-only and symmetric: an unreachable peer is skipped, never
  waited on — losing any machine loses no correctness.

## Coordination without locks

- **Soft claims** (`src/distributed/hints.ts`): "I intend to work on X" as
  grow-only CRDT state with a logical-time TTL (logical time = merge-history
  length — no wall clock to disagree about). Policy: consult hints only for
  *hot* names — fan-in centrality computed by the Kernighan–Lin partitioner
  (`src/swarm/partition.ts`), which also min-cuts the dependency graph into
  balanced, low-contention slices per agent. A hint is never a lock: a crashed
  announcer's hint expires and nothing was ever blocked on it.
- **Decision memory** (`src/distributed/memory.ts`): content-addressed,
  append-only, supersedable notes — `convention`, `spec` (pinned API
  contracts), `rejected-alternative`, and `assumption`. The planner pins shared
  contracts before any worker runs; workers feed the live notes for a task's
  targets into the agent prompt; and an agent that resolves ambiguity records a
  `# assume:` line that lands as a first-class assumption note instead of a
  question to a human.

## The worker loop

`src/swarm/worker.ts`, per task: gossip with peers → steer around hot names
another agent is actively on (soft) → announce own intent on hot targets →
collect governing decisions into the prompt → run the agent → submit through
the green-gate → merge. A rejection is retried with the compiler's actual error
in the next prompt; a task that keeps failing parks after an attempt budget, so
one bad task can never spin the loop. Assumptions in accepted code are recorded
to decision memory. See [`docs/swarm.md`](swarm.md).
