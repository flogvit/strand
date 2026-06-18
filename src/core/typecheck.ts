import { StrandTypeError } from "../errors.ts";
import type { Registry } from "./registry.ts";
import type { Store } from "./store.ts";
import type { CoreDef, CoreTerm, CtorDecl, DataDecl } from "./term.ts";
import { tBool, tCon, tInt, tText, tFun, tVar, tyOfSignature, type Ty } from "./types.ts";
import { freshFlex, instantiate, substVars, Unifier } from "./unify.ts";

/** The (polymorphic) type scheme of a constructor: fields -> the data type. */
function ctorType(decl: DataDecl, ctor: CtorDecl): Ty {
  return tyOfSignature(ctor.fields, tCon(decl.name, decl.params.map(tVar)));
}

/** Infer the type of a core term against a unifier. Polymorphic things (refs and
 *  constructors) are instantiated with fresh variables at each use. */
export function infer(
  t: CoreTerm,
  env: Map<string, Ty>,
  store: Store,
  registry: Registry,
  u: Unifier,
  selfTy?: Ty,
): Ty {
  const rec = (s: CoreTerm, e: Map<string, Ty>): Ty => infer(s, e, store, registry, u, selfTy);
  switch (t.tag) {
    case "IntLit":
      return tInt;
    case "BoolLit":
      return tBool;
    case "TextLit":
      return tText;
    case "Self":
      if (!selfTy) throw new StrandTypeError("recursion is not allowed here");
      return selfTy;
    case "Var": {
      const ty = env.get(t.name);
      if (!ty) throw new StrandTypeError(`unbound variable '${t.name}'`);
      return ty;
    }
    case "Ref": {
      const ty = store.typeOf(t.hash);
      if (!ty) throw new StrandTypeError(`unknown reference ${t.hash}`);
      return instantiate(ty);
    }
    case "Ctor": {
      const c = registry.ctors.get(t.ctor);
      if (!c) throw new StrandTypeError(`unknown constructor '${t.ctor}'`);
      return instantiate(ctorType(c.decl, c.ctor));
    }
    case "App": {
      const tf = rec(t.fn, env);
      const ta = rec(t.arg, env);
      const r = freshFlex();
      u.unify(tf, tFun(ta, r));
      return r;
    }
    case "BinOp": {
      const l = rec(t.left, env);
      const r = rec(t.right, env);
      if (t.op === "++") {
        u.unify(l, tText);
        u.unify(r, tText);
        return tText;
      }
      if (t.op === "&&" || t.op === "||") {
        u.unify(l, tBool);
        u.unify(r, tBool);
        return tBool;
      }
      if (t.op === "+" || t.op === "-" || t.op === "*" || t.op === "/" || t.op === "%") {
        u.unify(l, tInt);
        u.unify(r, tInt);
        return tInt;
      }
      if (t.op === "<" || t.op === ">" || t.op === "<=" || t.op === ">=") {
        u.unify(l, tInt);
        u.unify(r, tInt);
        return tBool;
      }
      u.unify(l, r); // ==
      return tBool;
    }
    case "If": {
      u.unify(rec(t.cond, env), tBool);
      const a = rec(t.then, env);
      const b = rec(t.else, env);
      u.unify(a, b);
      return a;
    }
    case "Match": {
      const scrutTy = rec(t.scrutinee, env);
      const result = freshFlex();
      for (const arm of t.arms) {
        if (arm.ctor === "_") {
          u.unify(result, rec(arm.body, env));
          continue;
        }
        const c = registry.ctors.get(arm.ctor);
        if (!c) throw new StrandTypeError(`unknown constructor '${arm.ctor}'`);
        const inst = new Map(c.decl.params.map((p) => [p, freshFlex()] as const));
        const dataTy = tCon(c.decl.name, c.decl.params.map((p) => inst.get(p)!));
        u.unify(scrutTy, dataTy);
        const fieldTys = c.ctor.fields.map((f) => substVars(f, inst));
        const env2 = new Map(env);
        arm.vars.forEach((v, i) => env2.set(v, fieldTys[i]));
        u.unify(result, rec(arm.body, env2));
      }
      // exhaustiveness: every constructor of the scrutinee's type must be covered, or a wildcard present
      if (!t.arms.some((a) => a.ctor === "_")) {
        const lead = t.arms.find((a) => a.ctor !== "_");
        const c = lead ? registry.ctors.get(lead.ctor) : undefined;
        if (c) {
          const covered = new Set(t.arms.map((a) => a.ctor));
          const missing = c.decl.ctors.filter((x) => !covered.has(x.name)).map((x) => x.name);
          if (missing.length > 0) throw new StrandTypeError(`non-exhaustive match: missing ${missing.join(", ")}`);
        }
      }
      return result;
    }
    case "Let": {
      const vt = rec(t.value, env);
      const env2 = new Map(env);
      env2.set(t.name, vt);
      return rec(t.body, env2);
    }
    case "Lam": {
      const env2 = new Map(env);
      env2.set(t.param, t.paramTy);
      return tFun(t.paramTy, rec(t.body, env2));
    }
  }
}

/** Typecheck a value definition and return its declared (curried) type. */
export function typecheckDef(def: CoreDef, store: Store, registry: Registry): Ty {
  const u = new Unifier();
  const selfTy = tyOfSignature(def.params.map((p) => p.ty), def.ret);
  const env = new Map<string, Ty>();
  for (const p of def.params) env.set(p.name, p.ty);
  const bodyTy = infer(def.body, env, store, registry, u, selfTy);
  u.unify(bodyTy, def.ret);
  return selfTy;
}
