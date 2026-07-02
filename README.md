# Strand

[![test](https://github.com/flogvit/strand/actions/workflows/test.yml/badge.svg)](https://github.com/flogvit/strand/actions/workflows/test.yml)
**[flogvit.github.io/strand](https://flogvit.github.io/strand/)** — the website, authored by a swarm, with the solver demo running live.

A content-addressed substrate and a small typed functional language, built so
that **many AI agents can author the same codebase in parallel and only the
things they genuinely contend over ever need a human.**

Git's text-and-files model makes parallel agent work collide constantly,
because coupling is implicit and the unit of change is a line in a file. Strand
removes the cause instead of patching the symptom: the unit of change is a
*definition*, identified by the hash of its structure, gated by the type
checker, merged as a CRDT.

**This is not a thought experiment.** A live swarm of `claude` workers has
authored a complete, independently-verified Sudoku generator through this
substrate (22/22 tasks green on the first attempt), and [the project's own
website](https://flogvit.github.io/strand/) — markup, copy and CSS — is Strand
code written by a swarm; its interactive demo runs the swarm's solver in your
browser.

## The idea

- **Code is content-addressed.** A definition is identified by the hash of its
  *structure* (parameter types, return type, body) — never its name. Two agents
  who independently write the same logic land on the same hash, so their work
  converges instead of conflicting.
- **References are by identity.** When a definition uses another, it pins that
  dependency's hash. Rebinding a *name* to new content can never silently break
  an existing caller — the caller still points at the exact version it was
  written against.
- **The type checker is the green-gate.** A definition that does not typecheck
  never enters the store, so a name can never point at red code.
- **Two planes.** Agents author in the content-addressed graph; humans read a
  faithful projection — the TypeScript the same graph transpiles to.
- **Conflict only on genuine contention.** Merging concurrent work is a question
  of "which name points where". Independent names merge with zero ceremony; the
  *only* conflict is two agents binding the **same name** to **different**
  content, and that conflict is parked (first-class, resolvable later) without
  blocking anything else.

## Try it

```bash
npm install
npm run demo                 # three agents author in parallel; one name parks
npm test                     # full suite (181 tests)

# or drive it directly:
npm run strand -- init
npm run strand -- submit --as alice --intent "adder" --code "def add (a: Int) (b: Int) -> Int = a + b"
npm run strand -- submit --as bob   --intent "doubler" --code "def double (n: Int) -> Int = add n n"
npm run strand -- merge
npm run strand -- eval "double 21"   # 42  (reference interpreter)
npm run strand -- run double         # transpile to TypeScript and execute
npm run strand -- emit               # print the TS projection of the namespace
```

## The swarm, live

`strand-swarm` runs the whole loop with real models: a shared task queue feeds
provider-agnostic workers (Claude, Codex, Gemini — an "agent" is a command plus
a prompt), each worker hands its task to a model and pushes the result through
the green-gate. Correctness is the gate's job, not the agent's: rejected output
is retried *with the compiler's actual error in the prompt*, and can never
corrupt the store.

```bash
npm run strand-swarm -- plan                                  # seed the Sudoku decomposition
npm run strand-swarm -- work --as w1 --provider claude        # run a live worker
npm run strand-swarm -- status                                # watch the board

# queue backends and multi-machine:
#   --gh owner/repo          GitHub issues as the shared queue (add tasks mid-run)
#   --peers http://host:port gossip with other machines while working
```

Measured, with a real `claude` model on the 22-task Sudoku graph
(`scripts/swarm-sudoku-live.ts` and friends):

| run | model calls | wall clock | gate rejections | outcome |
|---|---|---|---|---|
| swarm, 22 tasks | 22 | 480 s | 0 | 22/22 green on the first attempt, 157 model-written tests |
| swarm, 4 parallel workers | 25 | 452 s | 3 (recovered) | 22/22 green — chain-shaped graph, so parallelism pays little *here* |
| single agent, one call | 1 | 183 s | 0 | whole namespace in one reply |

The honest economics: one agent wins on a graph this small; the swarm's edge is
graphs wider than the critical path, codebases larger than one context window,
many machines, and systematically deeper test coverage (157 tests vs 39 for the
same code). The solver all three produced was verified against a known puzzle
by an oracle sharing zero code with the swarm (`scripts/oracle-sudoku.ts`) — in
**both** execution engines, which must agree cell for cell.

The website in [`site/`](site/) is the second live proof: 26 definitions (HTML
kit, components, copy, CSS) authored by a swarm with contracts pinned in shared
decision memory — 37/38 tasks green, and the page's interactive demo runs the
swarm's own solver in the browser.

## The distributed plane

Everything a swarm shares is convergent state — no coordinator, no single point
of failure, any subset of peers gossiping in any order reaches the same result:

- **The namespace is a state-based CRDT** (`src/distributed/crdt.ts`): per name
  a grow-only set of observations; one observed hash = resolved, several =
  parked; a resolution (human or supersession) is a monotone add. The repo-level
  merge (`src/repo.ts`) *is* this algebra — the batch merge is a thin adapter
  over it, so local and distributed merges agree by construction.
- **Sync is pull-only gossip over HTTP** (`src/distributed/transport.ts`): a
  peer serves its Merkle index, objects by hash, and CRDT state. Anti-entropy
  (`src/distributed/merkle.ts`) descends only where digests differ, so
  reconciliation costs O(diff), not O(store). A dead peer is skipped, never
  waited on.
- **Coordination is advisory, never a lock** (`src/distributed/hints.ts`): a
  worker announces soft intent on *hot* names (fan-in centrality from the
  Kernighan–Lin partitioner, `src/swarm/partition.ts`) and steers around live
  claims; a crashed claimant's hint simply expires.
- **Decisions are first-class memory** (`src/distributed/memory.ts`):
  conventions, pinned API contracts, and — most important — the assumptions an
  agent takes under ambiguity (`# assume: …` in its code) are recorded instead
  of asked, gossiped like everything else, and fed into every relevant prompt.
- **All of it persists and ships** (`src/persist.ts`): the CRDT namespace,
  hints and memory live in `.strand/` beside the store, so a restarting worker
  or a brand-new peer bootstraps from disk.

See [`docs/architecture.md`](docs/architecture.md) for the full picture and
[`docs/swarm.md`](docs/swarm.md) for running swarms.

## The language

A small but general-purpose, statically-typed functional language. It is
Turing-complete and transpiles to TypeScript — the reference interpreter and the
transpiled TS produce the same value (a differential oracle holds them to it),
so Strand needs no compiler of its own.

```
# recursion
def fac (n: Int) -> Int = if n < 1 then 1 else n * fac (n - 1)

# generic algebraic data types + pattern matching
data List a = Nil | Cons a (List a)
def length (xs: List a) -> Int = match xs { Nil -> 0 | Cons h t -> 1 + length t }
def map (f: a -> b) (xs: List a) -> List b =
  match xs { Nil -> Nil | Cons h t -> Cons (f h) (map f t) }

# text
def greet (name: Text) -> Text = "Hello, " ++ name
```

- Ground types `Int`, `Bool`, `Text`; curried functions; type constructors
  (`List a`, `Option a`) and type variables — generics checked by unification.
- `data` declarations (sum types; products are single-constructor data) and
  `record` types with named fields and `.field` access, exhaustive `match` with
  constructor patterns and a `_` wildcard, recursion (self and mutual),
  `if/then/else`, `let … in …`, lambdas (`fn (x: T) -> …`, closures included),
  arithmetic `+ - * / %` and text `++`, comparison `== < > <= >=`, boolean
  `&& ||`, juxtaposition application.
- Foreign TypeScript via `foreign name (p: T) -> R = "<ts expr>"` — a trusted
  binding the checker takes on faith and the backend emits verbatim.
- A minimal IO monad — `print : Text -> IO Unit`, `pure`, `andThen`. Run an
  action with `strand exec <name>`.
- Tests are definitions: any zero-arg `Bool` def is a test. `strand test` runs
  them and attests the dependency closure; `strand untested` lists what no test
  reaches; `strand require <name> tests` + `strand verify` make coverage a hard
  gate.
- A prelude (`lib/prelude.strand`) written in Strand itself, and real examples
  in `examples/` — including `sudoku-swarm.strand`, exported verbatim from a
  namespace a live model swarm authored. `npm run emit-examples` writes each
  example's transpiled TypeScript to `examples/out/`.

## Usable on real code: Strand over TypeScript

The same substrate runs over real TypeScript: agents author ordinary `.ts`
definitions in parallel, with the **real TypeScript compiler as the green-gate**.

```bash
npm run demo:ts
npm run strand-ts -- init
npm run strand-ts -- submit --as alice --intent adder --code "export function add(a: number, b: number): number { return a + b; }"
npm run strand-ts -- merge
npm run strand-ts -- eval "double(21)"   # after bob's double lands — runs the assembled TS
```

You get, on real code: definition-level content-addressing, conflict-free merge
of independent definitions, parking of genuine same-name contention, and `tsc`
itself rejecting any submission that does not type-check. The one thing a
name-based language cannot give for free is *reference by identity* — a rename
is not transparent to callers the way it is in the Strand language. That is the
honest "most of it, not all" trade.

## Project layout

```
src/core/         hashing, store, typechecker, interpreter — the substrate
src/syntax/       lexer, parser, printer
src/backend/      the TypeScript emitter
src/distributed/  CRDT namespace, sync, Merkle anti-entropy, transport, hints, memory
src/swarm/        queue (file + GitHub issues), workers, providers, planner, partitioner
src/ts/           the same substrate over real TypeScript
src/repo.ts       repo-level merge/resolve on the CRDT view
docs/             architecture and swarm guides
examples/         Strand programs + their TS projections (out/)
scripts/          live-run drivers, benchmarks, oracles, site builder
site/             the website — authored by a swarm, verified in a browser
test/             181 tests (node:test), one file per module
```

## Status & limits

A working language and substrate, not (yet) a production one. Type signatures
are optional (inference with generalization); lambdas and mutually-recursive
groups still need annotations. `Int` is a 64-bit-safe integer (exact to
2^53−1). Text has `++` and `==` but no substring primitives yet. `module Foo`
qualifies value names; types stay global. Tooling: formatter, checker, and an
LSP server (`npm run lsp`) with diagnostics and formatting; richer LSP features
are future. Zero-arg defs currently emit as eager consts, so importing a
projection executes them ([#34](https://github.com/flogvit/strand/issues/34)).
Deliberately out of scope for now: a general effect system (IO is the one
effect) and arbitrary-precision integers.

## Origins

Strand grew out of the design discussion in [`info/`](info/) (raw notes, in
Norwegian) and [`concept.md`](concept.md), under one north star: **let one
person safely run very many agents on one codebase.** The roadmap lives in the
[issue tracker](https://github.com/flogvit/strand/issues) — closed issues are
the honest build log.

## License

[MIT](LICENSE)
