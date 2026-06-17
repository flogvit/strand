# Strand

A content-addressed substrate and a small typed functional language, built so
that **many agents can author the same codebase in parallel and only the things
they genuinely contend over ever need a human.**

Strand grew out of the discussion in [`info/`](info/) and the design in
[`concept.md`](concept.md): git's text-and-files model makes parallel agent work
collide constantly, because coupling is implicit and the unit of change is a line
in a file. Strand removes the cause instead of patching the symptom.

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
npm run demo                 # three agents author in parallel; one name parks
npm test                     # full suite

# or drive it directly:
npm run strand -- init
npm run strand -- submit --as alice --intent "adder" --code "def add (a: Int) (b: Int) -> Int = a + b"
npm run strand -- submit --as bob   --intent "doubler" --code "def double (n: Int) -> Int = add n n"
npm run strand -- merge
npm run strand -- eval "double 21"   # 42  (reference interpreter)
npm run strand -- run double         # transpile to TypeScript and execute
npm run strand -- emit               # print the TS projection of the namespace
```

## The language (v1)

```
def add (a: Int) (b: Int) -> Int = a + b
def max (a: Int) (b: Int) -> Int = if a < b then b else a
def twice (f: Int -> Int) (n: Int) -> Int = f (f n)
```

Ground types `Int`, `Bool`, `Text`; curried functions; `+ - *`, `== < >`,
`if/then/else`; juxtaposition application. Definitions run on a reference
interpreter and transpile to TypeScript (the same value out of both).

## Status & limits

A working prototype, not a production language. Deliberately out of scope for
v1: recursion (a self-reference would make the content hash ill-founded),
type inference (signatures are explicit), and a standard library. The next wedge
is symbol-level coordination on top of this substrate — see `concept.md`.
