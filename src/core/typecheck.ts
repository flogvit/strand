import { StrandTypeError } from "../errors.ts";
import type { Store } from "./store.ts";
import type { CoreDef, CoreTerm } from "./term.ts";
import { tBool, tInt, tText, tyEqual, tyOfSignature, tyToString, type Ty } from "./types.ts";

/** Infer the type of a core term. References look their type up in the store
 *  by hash — so a caller is checked against the *exact* version of a dependency
 *  it pinned, never against whatever a name happens to point at now. */
export function typeOfTerm(t: CoreTerm, env: Map<string, Ty>, store: Store): Ty {
  switch (t.tag) {
    case "IntLit":
      return tInt;
    case "BoolLit":
      return tBool;
    case "TextLit":
      return tText;
    case "Var": {
      const ty = env.get(t.name);
      if (!ty) throw new StrandTypeError(`unbound variable '${t.name}'`);
      return ty;
    }
    case "Ref": {
      const ty = store.typeOf(t.hash);
      if (!ty) throw new StrandTypeError(`unknown reference ${t.hash}`);
      return ty;
    }
    case "App": {
      const tf = typeOfTerm(t.fn, env, store);
      if (tf.tag !== "Fun") throw new StrandTypeError(`cannot apply a non-function of type ${tyToString(tf)}`);
      const ta = typeOfTerm(t.arg, env, store);
      if (!tyEqual(ta, tf.from)) {
        throw new StrandTypeError(
          `argument of type ${tyToString(ta)} does not match parameter ${tyToString(tf.from)}`,
        );
      }
      return tf.to;
    }
    case "BinOp": {
      const l = typeOfTerm(t.left, env, store);
      const r = typeOfTerm(t.right, env, store);
      if (t.op === "+" || t.op === "-" || t.op === "*") {
        if (!tyEqual(l, tInt) || !tyEqual(r, tInt)) throw new StrandTypeError(`'${t.op}' expects Int operands`);
        return tInt;
      }
      if (t.op === "<" || t.op === ">") {
        if (!tyEqual(l, tInt) || !tyEqual(r, tInt)) throw new StrandTypeError(`'${t.op}' expects Int operands`);
        return tBool;
      }
      // "=="
      if (!tyEqual(l, r)) throw new StrandTypeError(`'==' expects operands of the same type`);
      if (l.tag === "Fun") throw new StrandTypeError(`'==' cannot compare functions`);
      return tBool;
    }
    case "If": {
      const c = typeOfTerm(t.cond, env, store);
      if (!tyEqual(c, tBool)) throw new StrandTypeError(`'if' condition must be Bool, got ${tyToString(c)}`);
      const a = typeOfTerm(t.then, env, store);
      const b = typeOfTerm(t.else, env, store);
      if (!tyEqual(a, b)) {
        throw new StrandTypeError(`'if' branches disagree: ${tyToString(a)} vs ${tyToString(b)}`);
      }
      return a;
    }
  }
}

/** Typecheck a definition and return its full (curried) type. Throwing here is
 *  Strand's green-gate: a definition that does not typecheck never enters the
 *  store, so a name can never point at red code. */
export function typecheckDef(def: CoreDef, store: Store): Ty {
  const env = new Map<string, Ty>();
  for (const p of def.params) env.set(p.name, p.ty);
  const bodyTy = typeOfTerm(def.body, env, store);
  if (!tyEqual(bodyTy, def.ret)) {
    throw new StrandTypeError(
      `body has type ${tyToString(bodyTy)} but declared return type is ${tyToString(def.ret)}`,
    );
  }
  return tyOfSignature(def.params.map((p) => p.ty), def.ret);
}
