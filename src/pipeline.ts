import { parseExpr, parseProgram } from "./syntax/parser.ts";
import type { SurfaceDef, SurfaceTerm } from "./syntax/ast.ts";
import { resolveData, resolveDef, resolveForeign, resolveGroupMember, resolveTerm } from "./core/resolve.ts";
import { infer, typecheckDef, typecheckGroup } from "./core/typecheck.ts";
import { evalTerm, type Value } from "./core/eval.ts";
import { Store } from "./core/store.ts";
import { buildRegistry, type Registry } from "./core/registry.ts";
import { Unifier } from "./core/unify.ts";
import { hashGroup, memberHash } from "./core/hash.ts";
import type { DataDecl, Hash } from "./core/term.ts";
import type { Namespace } from "./model.ts";

export interface Bind {
  name: string;
  hash: Hash;
  kind: "def" | "data";
}

/** The free names of a surface term (names not bound by params/let/lambda/match). */
function freeNames(t: SurfaceTerm, bound: Set<string>): Set<string> {
  const out = new Set<string>();
  const go = (s: SurfaceTerm, b: Set<string>): void => {
    switch (s.tag) {
      case "Name":
        if (!b.has(s.name)) out.add(s.name);
        break;
      case "App":
        go(s.fn, b);
        go(s.arg, b);
        break;
      case "BinOp":
        go(s.left, b);
        go(s.right, b);
        break;
      case "If":
        go(s.cond, b);
        go(s.then, b);
        go(s.else, b);
        break;
      case "Match":
        go(s.scrutinee, b);
        s.arms.forEach((a) => go(a.body, new Set([...b, ...a.vars])));
        break;
      case "Let":
        go(s.value, b);
        go(s.body, new Set([...b, s.name]));
        break;
      case "Lam":
        go(s.body, new Set([...b, s.param]));
        break;
      default:
        break;
    }
  };
  go(t, bound);
  return out;
}

/** Tarjan's SCC algorithm; returns components in reverse-topological order
 *  (a component's dependencies come before it). */
function tarjan(nodes: string[], succ: (n: string) => string[]): string[][] {
  let counter = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const out: string[][] = [];
  const connect = (v: string): void => {
    idx.set(v, counter);
    low.set(v, counter);
    counter++;
    stack.push(v);
    onStack.add(v);
    for (const w of succ(v)) {
      if (!idx.has(w)) {
        connect(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, idx.get(w)!));
      }
    }
    if (low.get(v) === idx.get(v)) {
      const comp: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      out.push(comp);
    }
  };
  for (const n of nodes) if (!idx.has(n)) connect(n);
  return out;
}

/** Compile a program against a base namespace. Data declarations are processed
 *  first (types may be referenced before they are declared); value definitions
 *  are grouped into strongly-connected components so that mutually-recursive
 *  definitions are hashed and checked as a unit. */
export function compileProgram(
  src: string,
  store: Store,
  baseNames: Map<string, Hash>,
  baseData: DataDecl[] = [],
): Bind[] {
  const items = parseProgram(src);
  const names = new Map(baseNames);
  const decls = [...baseData];
  const binds: Bind[] = [];

  for (const item of items) {
    if (item.kind === "data") {
      const decl = resolveData(item);
      const hash = store.putData(decl);
      decls.push(decl);
      binds.push({ name: decl.name, hash, kind: "data" });
    }
  }
  const registry = buildRegistry(decls);

  // foreign declarations: trusted bindings, available to the value defs that follow
  for (const item of items) {
    if (item.kind === "foreign") {
      const cdef = resolveForeign(item);
      const ty = typecheckDef(cdef, store, registry);
      const hash = store.put(cdef, ty);
      names.set(item.name, hash);
      binds.push({ name: item.name, hash, kind: "def" });
    }
  }

  const defItems = items.filter((i): i is SurfaceDef => i.kind === "def");
  const byName = new Map(defItems.map((d) => [d.name, d]));
  const defNames = new Set(byName.keys());
  const succ = (n: string): string[] => {
    const d = byName.get(n)!;
    return [...freeNames(d.body, new Set(d.params.map((p) => p.name)))].filter((x) => defNames.has(x));
  };

  for (const scc of tarjan([...defNames], succ)) {
    if (scc.length === 1 && !succ(scc[0]).includes(scc[0])) {
      // a plain definition (no self-reference)
      bindDef(scc[0]);
    } else if (scc.length === 1) {
      // single self-recursive definition — uses `Self`
      bindDef(scc[0]);
    } else {
      bindGroup([...scc].sort());
    }
  }
  return binds;

  function bindDef(name: string): void {
    const cdef = resolveDef(byName.get(name)!, names, registry);
    const ty = typecheckDef(cdef, store, registry);
    const hash = store.put(cdef, ty);
    names.set(name, hash);
    binds.push({ name, hash, kind: "def" });
  }

  function bindGroup(members: string[]): void {
    const groupMap = new Map(members.map((n, i) => [n, i]));
    const cdefs = members.map((n) => resolveGroupMember(byName.get(n)!, names, registry, groupMap));
    const tys = typecheckGroup(cdefs, store, registry);
    const groupHash = hashGroup(cdefs);
    const hashes = members.map((_, i) => memberHash(groupHash, i));
    cdefs.forEach((cd, i) => {
      cd.group = hashes;
      store.putAt(hashes[i], cd, tys[i]);
    });
    members.forEach((n, i) => {
      names.set(n, hashes[i]);
      binds.push({ name: n, hash: hashes[i], kind: "def" });
    });
  }
}

/** Compile and evaluate a single expression against a namespace context. */
export function evalQuery(
  src: string,
  store: Store,
  names: Map<string, Hash>,
  registry: Registry = buildRegistry([]),
): Value {
  const term = resolveTerm(parseExpr(src), new Set(), names, registry);
  infer(term, new Map(), store, registry, new Unifier());
  return evalTerm(term, new Map(), store, registry);
}

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
