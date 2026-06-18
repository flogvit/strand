import { createHash } from "node:crypto";
import type { CoreDef, CoreTerm, DataDecl, Hash } from "./term.ts";
import { tCon, tFun, tVar, tyToString, type Ty } from "./types.ts";

function sha(s: string): Hash {
  return "#" + createHash("sha256").update(s).digest("hex").slice(0, 8);
}

/** Canonicalize a term for hashing. Bound names (parameters, let/lambda binders,
 *  match-arm fields) are normalized to depth-indexed placeholders so that two
 *  terms that differ only in the names of bound variables hash identically. */
function canonicalTerm(t: CoreTerm, rename: Map<string, string>, depth: number): unknown {
  const rec = (s: CoreTerm): unknown => canonicalTerm(s, rename, depth);
  switch (t.tag) {
    case "Var":
      return { tag: "Var", name: rename.get(t.name) ?? t.name };
    case "Ref":
      return { tag: "Ref", hash: t.hash };
    case "Self":
      return { tag: "Self" };
    case "Cyc":
      return { tag: "Cyc", index: t.index };
    case "Ctor":
      return { tag: "Ctor", type: t.type, ctor: t.ctor };
    case "App":
      return { tag: "App", fn: rec(t.fn), arg: rec(t.arg) };
    case "BinOp":
      return { tag: "BinOp", op: t.op, left: rec(t.left), right: rec(t.right) };
    case "If":
      return { tag: "If", cond: rec(t.cond), then: rec(t.then), else: rec(t.else) };
    case "Match":
      return {
        tag: "Match",
        scrutinee: rec(t.scrutinee),
        arms: t.arms.map((arm) => {
          const r2 = new Map(rename);
          arm.vars.forEach((v, i) => r2.set(v, `$b${depth}_${i}`));
          return {
            ctor: arm.ctor,
            vars: arm.vars.map((_, i) => `$b${depth}_${i}`),
            body: canonicalTerm(arm.body, r2, depth + 1),
          };
        }),
      };
    case "Let": {
      const r2 = new Map(rename);
      r2.set(t.name, `$b${depth}`);
      return { tag: "Let", name: `$b${depth}`, value: rec(t.value), body: canonicalTerm(t.body, r2, depth + 1) };
    }
    case "Lam": {
      const r2 = new Map(rename);
      r2.set(t.param, `$b${depth}`);
      return {
        tag: "Lam",
        param: `$b${depth}`,
        paramTy: tyToString(t.paramTy),
        body: canonicalTerm(t.body, r2, depth + 1),
      };
    }
    default:
      return t; // literals
  }
}

function canonicalDef(def: CoreDef): unknown {
  const rename = new Map<string, string>();
  def.params.forEach((p, i) => rename.set(p.name, `$${i}`));
  return {
    params: def.params.map((p, i) => ({ name: `$${i}`, ty: tyToString(p.ty) })),
    ret: tyToString(def.ret),
    body: canonicalTerm(def.body, rename, 0),
  };
}

/** Content address of a value definition. */
export function hashOf(def: CoreDef): Hash {
  return sha(JSON.stringify(canonicalDef(def)));
}

/** Content address of a mutually-recursive group, hashed as a unit (in-group
 *  references are `Cyc` placeholders, so the hash is well-founded). */
export function hashGroup(defs: CoreDef[]): Hash {
  return sha(JSON.stringify(defs.map(canonicalDef)));
}

/** The hash of the index-th member of a group. */
export function memberHash(groupHash: Hash, index: number): Hash {
  return `${groupHash}.${index}`;
}

function renameTyVars(t: Ty, m: Map<string, string>): Ty {
  switch (t.tag) {
    case "Var":
      return tVar(m.get(t.name) ?? t.name);
    case "Fun":
      return tFun(renameTyVars(t.from, m), renameTyVars(t.to, m));
    case "Con":
      return tCon(t.name, t.args.map((a) => renameTyVars(a, m)));
    default:
      return t;
  }
}

/** Content address of a data declaration. */
export function hashData(decl: DataDecl): Hash {
  const m = new Map(decl.params.map((p, i) => [p, `$${i}`]));
  return sha(
    JSON.stringify({
      name: decl.name,
      params: decl.params.map((_, i) => `$${i}`),
      ctors: decl.ctors.map((c) => ({ name: c.name, fields: c.fields.map((f) => tyToString(renameTyVars(f, m))) })),
    }),
  );
}
