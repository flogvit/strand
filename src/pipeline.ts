import { parseExpr, parseProgram } from "./syntax/parser.ts";
import { resolveData, resolveDef, resolveTerm } from "./core/resolve.ts";
import { infer, typecheckDef } from "./core/typecheck.ts";
import { evalTerm, type Value } from "./core/eval.ts";
import { Store } from "./core/store.ts";
import { buildRegistry, type Registry } from "./core/registry.ts";
import { Unifier } from "./core/unify.ts";
import type { DataDecl, Hash } from "./core/term.ts";
import type { Namespace } from "./model.ts";

export interface Bind {
  name: string;
  hash: Hash;
  kind: "def" | "data";
}

/** Compile a program against a base namespace: each item is resolved,
 *  type-checked (green-gate), and content-addressed. Data declarations register
 *  types/constructors for the items that follow. Returns the bindings produced. */
export function compileProgram(
  src: string,
  store: Store,
  baseNames: Map<string, Hash>,
  baseData: DataDecl[] = [],
): Bind[] {
  const names = new Map(baseNames);
  const decls = [...baseData];
  let registry = buildRegistry(decls);
  const binds: Bind[] = [];
  for (const item of parseProgram(src)) {
    if (item.kind === "data") {
      const decl = resolveData(item);
      const hash = store.putData(decl);
      decls.push(decl);
      registry = buildRegistry(decls);
      binds.push({ name: decl.name, hash, kind: "data" });
    } else {
      const cdef = resolveDef(item, names, registry);
      const ty = typecheckDef(cdef, store, registry);
      const hash = store.put(cdef, ty);
      names.set(item.name, hash);
      binds.push({ name: item.name, hash, kind: "def" });
    }
  }
  return binds;
}

/** Compile and evaluate a single expression against a namespace context. */
export function evalQuery(
  src: string,
  store: Store,
  names: Map<string, Hash>,
  registry: Registry = buildRegistry([]),
): Value {
  const term = resolveTerm(parseExpr(src), new Set(), names, registry);
  infer(term, new Map(), store, registry, new Unifier()); // green-gate for the query
  return evalTerm(term, new Map(), store, registry);
}

/** Reconstruct the resolution context from a persisted namespace. */
export function dataDeclsOf(namespace: Namespace, store: Store): DataDecl[] {
  const out: DataDecl[] = [];
  const seen = new Set<Hash>();
  for (const b of namespace.values()) {
    const d = store.dataOf(b.hash);
    if (d && !seen.has(b.hash)) {
      seen.add(b.hash);
      out.push(d);
    }
  }
  return out;
}

export function valueNamesOf(namespace: Namespace, store: Store): Map<string, Hash> {
  const m = new Map<string, Hash>();
  for (const [name, b] of namespace) if (store.defOf(b.hash)) m.set(name, b.hash);
  return m;
}

export function registryOf(namespace: Namespace, store: Store): Registry {
  return buildRegistry(dataDeclsOf(namespace, store));
}
