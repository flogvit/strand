import { StrandEvalError } from "../errors.ts";
import type { Registry } from "./registry.ts";
import type { Store } from "./store.ts";
import type { BinOp, CoreDef, CoreTerm } from "./term.ts";

/** Runtime values. A named function is a Closure; an anonymous function is a Lam
 *  (capturing its environment); a partially-applied constructor is a Ctor; a
 *  fully-applied constructor is a Data value. */
export type Value =
  | { tag: "Int"; value: number }
  | { tag: "Bool"; value: boolean }
  | { tag: "Text"; value: string }
  | { tag: "Closure"; def: CoreDef; applied: Value[] }
  | { tag: "Lam"; param: string; body: CoreTerm; env: Map<string, Value>; selfDef?: CoreDef }
  | { tag: "Ctor"; ctor: string; arity: number; args: Value[] }
  | { tag: "Data"; ctor: string; fields: Value[] };

function atom(v: Value): string {
  return v.tag === "Data" && v.fields.length > 0 ? `(${valueToString(v)})` : valueToString(v);
}

export function valueToString(v: Value): string {
  switch (v.tag) {
    case "Int":
      return String(v.value);
    case "Bool":
      return String(v.value);
    case "Text":
      return JSON.stringify(v.value);
    case "Closure":
      return `<fn/${v.def.params.length - v.applied.length}>`;
    case "Lam":
      return "<fn>";
    case "Ctor":
      return `<ctor ${v.ctor}/${v.arity - v.args.length}>`;
    case "Data":
      return v.fields.length ? `${v.ctor} ${v.fields.map(atom).join(" ")}` : v.ctor;
  }
}

function structuralEq(a: Value, b: Value): boolean {
  if (a.tag !== b.tag) return false;
  if (a.tag === "Data" && b.tag === "Data") {
    return a.ctor === b.ctor && a.fields.length === b.fields.length && a.fields.every((x, i) => structuralEq(x, b.fields[i]));
  }
  if (a.tag === "Int" || a.tag === "Bool" || a.tag === "Text") return a.value === (b as { value: unknown }).value;
  return false;
}

function computeBinOp(op: BinOp, l: Value, r: Value): Value {
  if (op === "++") return { tag: "Text", value: (l as { value: string }).value + (r as { value: string }).value };
  if (op === "==") return { tag: "Bool", value: structuralEq(l, r) };
  if (op === "&&") return { tag: "Bool", value: (l as { value: boolean }).value && (r as { value: boolean }).value };
  if (op === "||") return { tag: "Bool", value: (l as { value: boolean }).value || (r as { value: boolean }).value };
  const li = (l as { value: number }).value;
  const ri = (r as { value: number }).value;
  switch (op) {
    case "+":
      return { tag: "Int", value: li + ri };
    case "-":
      return { tag: "Int", value: li - ri };
    case "*":
      return { tag: "Int", value: li * ri };
    case "/":
      return { tag: "Int", value: Math.trunc(li / ri) };
    case "%":
      return { tag: "Int", value: li % ri };
    case "<":
      return { tag: "Bool", value: li < ri };
    case ">":
      return { tag: "Bool", value: li > ri };
    case "<=":
      return { tag: "Bool", value: li <= ri };
    case ">=":
      return { tag: "Bool", value: li >= ri };
  }
  throw new StrandEvalError(`bad operator ${op}`);
}

function toJs(v: Value): unknown {
  if (v.tag === "Int" || v.tag === "Bool" || v.tag === "Text") return v.value;
  throw new StrandEvalError("cannot pass a non-scalar value to foreign code");
}

function fromJs(x: unknown): Value {
  if (typeof x === "number") return { tag: "Int", value: x };
  if (typeof x === "boolean") return { tag: "Bool", value: x };
  if (typeof x === "string") return { tag: "Text", value: x };
  throw new StrandEvalError("foreign code returned a non-scalar value");
}

function callForeign(def: CoreDef, args: Value[]): Value {
  const code = (def.body as { tag: "Foreign"; code: string }).code;
  const fn = new Function(...def.params.map((p) => p.name), `return (${code});`);
  return fromJs(fn(...args.map(toJs)));
}

function apply(fn: Value, arg: Value, store: Store, registry: Registry): Value {
  if (fn.tag === "Ctor") {
    const args = [...fn.args, arg];
    if (args.length < fn.arity) return { tag: "Ctor", ctor: fn.ctor, arity: fn.arity, args };
    return { tag: "Data", ctor: fn.ctor, fields: args };
  }
  if (fn.tag === "Lam") {
    const env2 = new Map(fn.env);
    env2.set(fn.param, arg);
    return evalTerm(fn.body, env2, store, registry, fn.selfDef);
  }
  if (fn.tag !== "Closure") throw new StrandEvalError("applied a non-function value");
  const applied = [...fn.applied, arg];
  if (applied.length < fn.def.params.length) return { tag: "Closure", def: fn.def, applied };
  if (fn.def.body.tag === "Foreign") return callForeign(fn.def, applied);
  const env = new Map<string, Value>();
  fn.def.params.forEach((p, i) => env.set(p.name, applied[i]));
  return evalTerm(fn.def.body, env, store, registry, fn.def);
}

/** Evaluate a core term. */
export function evalTerm(
  t: CoreTerm,
  env: Map<string, Value>,
  store: Store,
  registry: Registry,
  selfDef?: CoreDef,
): Value {
  const rec = (s: CoreTerm, e: Map<string, Value>): Value => evalTerm(s, e, store, registry, selfDef);
  switch (t.tag) {
    case "IntLit":
      return { tag: "Int", value: t.value };
    case "BoolLit":
      return { tag: "Bool", value: t.value };
    case "TextLit":
      return { tag: "Text", value: t.value };
    case "Self":
      if (!selfDef) throw new StrandEvalError("`Self` used outside a definition");
      return { tag: "Closure", def: selfDef, applied: [] };
    case "Cyc": {
      if (!selfDef || !selfDef.group) throw new StrandEvalError("`Cyc` used outside a recursive group");
      const def = store.defOf(selfDef.group[t.index]);
      if (!def) throw new StrandEvalError(`dangling group member ${t.index}`);
      if (def.params.length === 0) return evalTerm(def.body, new Map(), store, registry, def);
      return { tag: "Closure", def, applied: [] };
    }
    case "Var": {
      const v = env.get(t.name);
      if (!v) throw new StrandEvalError(`unbound variable '${t.name}'`);
      return v;
    }
    case "Ref": {
      const def = store.defOf(t.hash);
      if (!def) throw new StrandEvalError(`dangling reference ${t.hash}`);
      if (def.params.length === 0) return evalTerm(def.body, new Map(), store, registry, def);
      return { tag: "Closure", def, applied: [] };
    }
    case "Ctor": {
      const c = registry.ctors.get(t.ctor);
      if (!c) throw new StrandEvalError(`unknown constructor '${t.ctor}'`);
      const arity = c.ctor.fields.length;
      if (arity === 0) return { tag: "Data", ctor: t.ctor, fields: [] };
      return { tag: "Ctor", ctor: t.ctor, arity, args: [] };
    }
    case "App":
      return apply(rec(t.fn, env), rec(t.arg, env), store, registry);
    case "BinOp":
      return computeBinOp(t.op, rec(t.left, env), rec(t.right, env));
    case "If":
      return (rec(t.cond, env) as { value: boolean }).value ? rec(t.then, env) : rec(t.else, env);
    case "Match": {
      const s = rec(t.scrutinee, env);
      if (s.tag !== "Data") throw new StrandEvalError("match on a non-data value");
      const arm = t.arms.find((a) => a.ctor === s.ctor) ?? t.arms.find((a) => a.ctor === "_");
      if (!arm) throw new StrandEvalError(`no match arm for constructor '${s.ctor}'`);
      const env2 = new Map(env);
      arm.vars.forEach((v, i) => env2.set(v, s.fields[i]));
      return rec(arm.body, env2);
    }
    case "Let": {
      const v = rec(t.value, env);
      const env2 = new Map(env);
      env2.set(t.name, v);
      return rec(t.body, env2);
    }
    case "Lam":
      return { tag: "Lam", param: t.param, body: t.body, env: new Map(env), selfDef };
    case "Foreign":
      return fromJs(new Function(`return (${t.code});`)());
  }
}
