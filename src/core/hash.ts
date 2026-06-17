import { createHash } from "node:crypto";
import type { CoreDef, CoreTerm, DataDecl, Hash } from "./term.ts";
import { tCon, tFun, tVar, tyToString, type Ty } from "./types.ts";

function sha(s: string): Hash {
  return "#" + createHash("sha256").update(s).digest("hex").slice(0, 8);
}

function canonicalTerm(t: CoreTerm, rename: Map<string, string>): unknown {
  switch (t.tag) {
    case "Var":
      return { tag: "Var", name: rename.get(t.name) ?? t.name };
    case "Ref":
      return { tag: "Ref", hash: t.hash };
    case "Self":
      return { tag: "Self" };
    case "Ctor":
      return { tag: "Ctor", type: t.type, ctor: t.ctor };
    case "App":
      return { tag: "App", fn: canonicalTerm(t.fn, rename), arg: canonicalTerm(t.arg, rename) };
    case "BinOp":
      return { tag: "BinOp", op: t.op, left: canonicalTerm(t.left, rename), right: canonicalTerm(t.right, rename) };
    case "If":
      return {
        tag: "If",
        cond: canonicalTerm(t.cond, rename),
        then: canonicalTerm(t.then, rename),
        else: canonicalTerm(t.else, rename),
      };
    case "Match":
      return {
        tag: "Match",
        scrutinee: canonicalTerm(t.scrutinee, rename),
        arms: t.arms.map((arm) => {
          const r2 = new Map(rename);
          arm.vars.forEach((v, i) => r2.set(v, `$p${i}`));
          return { ctor: arm.ctor, vars: arm.vars.map((_, i) => `$p${i}`), body: canonicalTerm(arm.body, r2) };
        }),
      };
    default:
      return t; // literals
  }
}

/** Content address of a value definition: a hash over its structure (parameter
 *  types, return type, body), with parameter names normalized so that two defs
 *  differing only in parameter naming hash identically. */
export function hashOf(def: CoreDef): Hash {
  const rename = new Map<string, string>();
  def.params.forEach((p, i) => rename.set(p.name, `$${i}`));
  return sha(
    JSON.stringify({
      params: def.params.map((p, i) => ({ name: `$${i}`, ty: tyToString(p.ty) })),
      ret: tyToString(def.ret),
      body: canonicalTerm(def.body, rename),
    }),
  );
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

/** Content address of a data declaration. The type and constructor names are
 *  load-bearing (types are referenced by name), so they are included; type
 *  parameter names are normalized. */
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
