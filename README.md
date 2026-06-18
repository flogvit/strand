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

## Usable on real code: Strand over TypeScript

The toy language above proves the substrate; to make it *usable*, the same
substrate runs over real TypeScript. Agents author ordinary `.ts` definitions in
parallel, and Strand provides the conflict-free authoring layer — with the
**real TypeScript compiler as the green-gate**.

```bash
npm run demo:ts              # agents author real TS in parallel; one name parks

npm run strand-ts -- init
npm run strand-ts -- submit --as alice --intent adder --code "export function add(a: number, b: number): number { return a + b; }"
npm run strand-ts -- merge
npm run strand-ts -- submit --as bob --intent doubler --code "export const double = (n: number): number => add(n, n);"
npm run strand-ts -- merge
npm run strand-ts -- eval "double(21)"   # 42 — runs the assembled real TypeScript
npm run strand-ts -- build               # print the assembled .ts module
```

You get, on real code: definition-level content-addressing, conflict-free merge
of independent definitions, parking of genuine same-name contention, and `tsc`
itself rejecting any submission that does not type-check. The one thing a
name-based language cannot give for free is *reference by identity* — TypeScript
resolves references by name, so a rename is not transparent to callers the way
it is in the Strand language. That is the honest "most of it, not all" trade.

## The language

A small but general-purpose, statically-typed functional language. It is
Turing-complete and transpiles to TypeScript — the reference interpreter and the
transpiled TS produce the same value, so Strand needs no compiler of its own.

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
  `record` types with named fields and `.field` access (`record Point { x: Int,
  y: Int }`, `p.x`), exhaustive `match` with constructor patterns and a `_`
  wildcard, recursion
  (self and mutual), `if/then/else`, `let … in …`, lambdas
  (`fn (x: T) -> …`, closures included), arithmetic `+ - * / %` and text `++`,
  comparison `== < > <= >=`, boolean `&& ||`, juxtaposition application.
- Foreign TypeScript via `foreign name (p: T) -> R = "<ts expr>"` — a trusted
  binding the checker takes on faith and the backend emits verbatim (e.g.
  `foreign sqrtFloor (n: Int) -> Int = "Math.floor(Math.sqrt(n))"`).
- A minimal IO monad — `print : Text -> IO Unit`, `pure`, `andThen`, with `Unit`
  and `IO` types. Run an action with `strand exec <name>`; transpiles to thunks.
- A prelude (`lib/prelude.strand`) — `List`, `Option`, `map`, `filter`, `foldr`,
  `length`, `append`, `range`, `sum` — written in Strand itself.
- Real examples in `examples/` — quicksort + an expression evaluator
  (`program.strand`), list utilities (`lists.strand`), a generic binary search
  tree and tree sort (`trees.strand`), and `Result`-based error handling
  (`result.strand`). `npm run emit-examples` writes each one's transpiled
  TypeScript to `examples/out/` so the Strand → TS mapping is visible.

```bash
npm run strand -- init
npm run strand -- submit --as alice --intent prelude --file lib/prelude.strand
npm run strand -- merge
npm run strand -- submit --as bob --intent program --file examples/program.strand
npm run strand -- merge
npm run strand -- eval "qsort (Cons 3 (Cons 1 (Cons 2 Nil)))"          # Cons 1 (Cons 2 (Cons 3 Nil))
npm run strand -- eval "evalExpr (Add (Num 2) (Mul (Num 3) (Num 4)))"  # 14
```

## Status & limits

A working language, not (yet) a production one. The conflict-free substrate
covers every definition — values *and* types — and whole-namespace type-checking
runs at merge, so a type rebind that would turn a green definition red is caught.

Type signatures are optional: omitted parameter and return types are inferred
(with generalization, so `def id x = x` is polymorphic). Lambdas and
mutually-recursive groups still need annotations.

`Int` is a 64-bit-safe integer (a JavaScript double, exact to 2^53−1);
arbitrary-precision integers are out of scope.

Deliberately out of scope for now: modules beyond the flat namespace, a general
effect system (IO is the one effect), and content-addressed *types* (types are
referenced by name; values are by content hash).
