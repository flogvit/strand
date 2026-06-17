import { parseExpr, parseProgram } from "./syntax/parser.ts";
import { resolveDef, resolveTerm } from "./core/resolve.ts";
import { typecheckDef, typeOfTerm } from "./core/typecheck.ts";
import { evalTerm, type Value } from "./core/eval.ts";
import { Store } from "./core/store.ts";
import type { Hash } from "./core/term.ts";

export interface Bind {
  name: string;
  hash: Hash;
}

/** Compile a program (source) against a base namespace: for each definition,
 *  resolve names to hashes, typecheck (green-gate), and put the content in the
 *  store. Returns the name->hash bindings produced. Definitions may reference
 *  earlier definitions in the same source. The store is mutated; baseNames is
 *  not. This is the shared path used by both the test-suite and `strand submit`. */
export function compileProgram(src: string, store: Store, baseNames: Map<string, Hash>): Bind[] {
  const names = new Map(baseNames);
  const binds: Bind[] = [];
  for (const sdef of parseProgram(src)) {
    const cdef = resolveDef(sdef, names);
    const ty = typecheckDef(cdef, store);
    const hash = store.put(cdef, ty);
    names.set(sdef.name, hash);
    binds.push({ name: sdef.name, hash });
  }
  return binds;
}

/** Compile and evaluate a single expression against a namespace. The expression
 *  is typechecked first, so an ill-typed query is rejected, not run. */
export function evalQuery(src: string, store: Store, names: Map<string, Hash>): Value {
  const term = resolveTerm(parseExpr(src), new Set(), names);
  typeOfTerm(term, new Map(), store); // green-gate for ad-hoc queries
  return evalTerm(term, new Map(), store);
}
