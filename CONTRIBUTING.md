# Contributing

Strand is a research substrate with a working implementation. Contributions
are welcome — the bar is the same one the agent swarm is held to: green
through the gate, tested first, honest about limits.

## Setup

```bash
npm install
npm test          # the full suite must be green (node:test via tsx)
```

Node 22+ (everything runs through `tsx`, no build step). The sole runtime
dependency is `typescript`.

## How work happens here

- **The roadmap is the issue tracker.** Issues follow a Gap / Do / Why shape —
  what is missing, what to build, why it matters. Closed issues are the build
  log; read a few before opening one.
- **Tests first.** Every behavior change starts with a failing test
  (`test/*.test.ts`, one file per module). Watch it fail for the right reason,
  then implement. PRs whose tests could not have failed are asked to redo them.
- **The suite stays green.** `npm test` before every commit. CI enforces it on
  push and PR.
- **Verification beyond tests.** Claims like "the solver works" are backed by
  external oracles (see `scripts/oracle-sudoku.ts`) — checkers that share no
  code with what they verify. If you add a capability, think about what its
  oracle is.
- **Commit style:** `feat(scope): …`, `fix(scope): …`, `docs: …`, `chore: …` —
  imperative subject, body explains the why. Reference issues with
  `Closes #N`.

## Where things live

See the project layout in the [README](README.md#project-layout) and the maps
in [`docs/architecture.md`](docs/architecture.md) and
[`docs/swarm.md`](docs/swarm.md).

## Running a swarm against your changes

The live drivers in `scripts/` (Sudoku, the website) are the integration
proof. They spend real model calls — run them deliberately, not in CI.
