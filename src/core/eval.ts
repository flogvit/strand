import { StrandEvalError } from "../errors.ts";
import type { Registry } from "./registry.ts";
import type { Store } from "./store.ts";
import type { BinOp, CoreDef, CoreTerm } from "./term.ts";
import { PRIM_ARITY } from "./prims.ts";

/** Runtime values. A named function is a Closure; an anonymous function is a Lam
 *  (capturing its environment); a partially-applied constructor is a Ctor; a
 *  fully-applied constructor is a Data value; an IO is a deferred effect; a
 *  Native is a partially-applied built-in primitive. */
export type Value =
  | { tag: "Int"; value: number }
  | { tag: "Bool"; value: boolean }
  | { tag: "Text"; value: string }
  | { tag: "Closure"; def: CoreDef; applied: Value[] }
  | { tag: "Lam"; param: string; body: CoreTerm; env: Map<string, Value>; selfDef?: CoreDef }
  | { tag: "Ctor"; ctor: string; arity: number; args: Value[] }
  | { tag: "Data"; ctor: string; fields: Value[] }
  | { tag: "IO"; run: () => Value }
  | { tag: "Native"; name: string; arity: number; args: Value[] };

/** Render a value without JS-stack recursion, so arbitrarily deep data
 *  (a 100k-element list) prints instead of crashing. */
export function valueToString(v: Value): string {
  let out = "";
  const stack: (Value | string)[] = [v];
  while (stack.length) {
    const x = stack.pop()!;
    if (typeof x === "string") {
      out += x;
      continue;
    }
    switch (x.tag) {
      case "Int":
      case "Bool":
        out += String(x.value);
        break;
      case "Text":
        out += JSON.stringify(x.value);
        break;
      case "Closure":
        out += `<fn/${x.def.params.length - x.applied.length}>`;
        break;
      case "Lam":
        out += "<fn>";
        break;
      case "Ctor":
        out += `<ctor ${x.ctor}/${x.arity - x.args.length}>`;
        break;
      case "IO":
        out += "<io>";
        break;
      case "Native":
        out += `<prim ${x.name}/${x.arity - x.args.length}>`;
        break;
      case "Data": {
        out += x.ctor;
        for (let i = x.fields.length - 1; i >= 0; i--) {
          const f = x.fields[i];
          if (f.tag === "Data" && f.fields.length > 0) stack.push(")", f, " (");
          else stack.push(f, " ");
        }
        break;
      }
    }
  }
  return out;
}

const UNIT: Value = { tag: "Data", ctor: "Unit", fields: [] };

function runPrim(name: string, args: Value[], store: Store, registry: Registry): Value {
  const text = (i: number): string => (args[i] as { value: string }).value;
  const int = (i: number): number => (args[i] as { value: number }).value;
  switch (name) {
    case "print":
      return { tag: "IO", run: () => (console.log((args[0] as { value: string }).value), UNIT) };
    case "textLength":
      return { tag: "Int", value: text(0).length };
    case "charAt": {
      const i = int(0);
      const s = text(1);
      return { tag: "Text", value: i >= 0 && i < s.length ? s[i] : "" };
    }
    case "substring":
      return { tag: "Text", value: text(2).slice(Math.max(0, int(0)), Math.max(0, int(1))) };
    case "intToText":
      return { tag: "Text", value: String(int(0)) };
    case "pure":
      return { tag: "IO", run: () => args[0] };
    case "andThen":
      return {
        tag: "IO",
        run: () => {
          const a = (args[0] as { tag: "IO"; run: () => Value }).run();
          const next = apply(args[1], a, store, registry);
          return (next as { tag: "IO"; run: () => Value }).run();
        },
      };
  }
  throw new StrandEvalError(`unknown primitive '${name}'`);
}

function structuralEq(a0: Value, b0: Value): boolean {
  const stack: [Value, Value][] = [[a0, b0]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    if (a.tag !== b.tag) return false;
    if (a.tag === "Data" && b.tag === "Data") {
      if (a.ctor !== b.ctor || a.fields.length !== b.fields.length) return false;
      for (let i = 0; i < a.fields.length; i++) stack.push([a.fields[i], b.fields[i]]);
      continue;
    }
    if (a.tag === "Int" || a.tag === "Bool" || a.tag === "Text") {
      if (a.value !== (b as { value: unknown }).value) return false;
      continue;
    }
    return false;
  }
  return true;
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

type Env = Map<string, Value>;

/** A pending evaluation: the machine continues with this term. */
type EvalState = { term: CoreTerm; env: Env; self?: CoreDef };

/** One step of application. Returns either a finished value or the body
 *  evaluation the machine should continue with (instead of recursing). */
function applyStep(fn: Value, arg: Value, store: Store, registry: Registry): Value | EvalState {
  if (fn.tag === "Native") {
    const args = [...fn.args, arg];
    if (args.length < fn.arity) return { tag: "Native", name: fn.name, arity: fn.arity, args };
    return runPrim(fn.name, args, store, registry);
  }
  if (fn.tag === "Ctor") {
    const args = [...fn.args, arg];
    if (args.length < fn.arity) return { tag: "Ctor", ctor: fn.ctor, arity: fn.arity, args };
    return { tag: "Data", ctor: fn.ctor, fields: args };
  }
  if (fn.tag === "Lam") {
    const env2 = new Map(fn.env);
    env2.set(fn.param, arg);
    return { term: fn.body, env: env2, self: fn.selfDef };
  }
  if (fn.tag !== "Closure") throw new StrandEvalError("applied a non-function value");
  const applied = [...fn.applied, arg];
  if (applied.length < fn.def.params.length) return { tag: "Closure", def: fn.def, applied };
  if (fn.def.body.tag === "Foreign") return callForeign(fn.def, applied);
  const env = new Map<string, Value>();
  fn.def.params.forEach((p, i) => env.set(p.name, applied[i]));
  return { term: fn.def.body, env, self: fn.def };
}

function isState(x: Value | EvalState): x is EvalState {
  return (x as EvalState).term !== undefined;
}

/** Apply a function value outside the machine (used by the IO runtime). */
function apply(fn: Value, arg: Value, store: Store, registry: Registry): Value {
  const r = applyStep(fn, arg, store, registry);
  return isState(r) ? runMachine(r, store, registry) : r;
}

/** Continuation frames for the explicit-stack machine. Work items are either
 *  an instruction or an EvalState; results flow through a value stack. The
 *  JS call stack stays flat no matter how deep the Strand recursion goes (#40). */
type Ins =
  | { op: "app" }
  | { op: "bin"; b: BinOp }
  | { op: "if"; then: CoreTerm; els: CoreTerm; env: Env; self?: CoreDef }
  | { op: "match"; arms: Extract<CoreTerm, { tag: "Match" }>["arms"]; env: Env; self?: CoreDef }
  | { op: "let"; name: string; body: CoreTerm; env: Env; self?: CoreDef }
  | { op: "field"; index: number };

function runMachine(start: EvalState, store: Store, registry: Registry): Value {
  const work: (Ins | EvalState)[] = [start];
  const vals: Value[] = [];
  while (work.length) {
    const item = work.pop()!;
    if ("op" in item) {
      switch (item.op) {
        case "app": {
          const arg = vals.pop()!;
          const fn = vals.pop()!;
          const r = applyStep(fn, arg, store, registry);
          if (isState(r)) work.push(r);
          else vals.push(r);
          break;
        }
        case "bin": {
          const right = vals.pop()!;
          const left = vals.pop()!;
          vals.push(computeBinOp(item.b, left, right));
          break;
        }
        case "if": {
          const cond = vals.pop()! as { value: boolean };
          work.push({ term: cond.value ? item.then : item.els, env: item.env, self: item.self });
          break;
        }
        case "match": {
          const s = vals.pop()!;
          if (s.tag !== "Data") throw new StrandEvalError("match on a non-data value");
          const arm = item.arms.find((a) => a.ctor === s.ctor) ?? item.arms.find((a) => a.ctor === "_");
          if (!arm) throw new StrandEvalError(`no match arm for constructor '${s.ctor}'`);
          const env2 = new Map(item.env);
          arm.vars.forEach((v, i) => env2.set(v, s.fields[i]));
          work.push({ term: arm.body, env: env2, self: item.self });
          break;
        }
        case "let": {
          const v = vals.pop()!;
          const env2 = new Map(item.env);
          env2.set(item.name, v);
          work.push({ term: item.body, env: env2, self: item.self });
          break;
        }
        case "field": {
          const rv = vals.pop()!;
          if (rv.tag !== "Data") throw new StrandEvalError("field access on a non-record value");
          vals.push(rv.fields[item.index]);
          break;
        }
      }
      continue;
    }

    const { term: t, env, self: selfDef } = item;
    switch (t.tag) {
      case "IntLit":
        vals.push({ tag: "Int", value: t.value });
        break;
      case "BoolLit":
        vals.push({ tag: "Bool", value: t.value });
        break;
      case "TextLit":
        vals.push({ tag: "Text", value: t.value });
        break;
      case "Self":
        if (!selfDef) throw new StrandEvalError("`Self` used outside a definition");
        vals.push({ tag: "Closure", def: selfDef, applied: [] });
        break;
      case "Cyc": {
        if (!selfDef || !selfDef.group) throw new StrandEvalError("`Cyc` used outside a recursive group");
        const def = store.defOf(selfDef.group[t.index]);
        if (!def) throw new StrandEvalError(`dangling group member ${t.index}`);
        if (def.params.length === 0) work.push({ term: def.body, env: new Map(), self: def });
        else vals.push({ tag: "Closure", def, applied: [] });
        break;
      }
      case "Var": {
        const v = env.get(t.name);
        if (!v) throw new StrandEvalError(`unbound variable '${t.name}'`);
        vals.push(v);
        break;
      }
      case "Ref": {
        const def = store.defOf(t.hash);
        if (!def) throw new StrandEvalError(`dangling reference ${t.hash}`);
        if (def.params.length === 0) work.push({ term: def.body, env: new Map(), self: def });
        else vals.push({ tag: "Closure", def, applied: [] });
        break;
      }
      case "Ctor": {
        const c = registry.ctors.get(t.ctor);
        if (!c) throw new StrandEvalError(`unknown constructor '${t.ctor}'`);
        const arity = c.ctor.fields.length;
        vals.push(arity === 0 ? { tag: "Data", ctor: t.ctor, fields: [] } : { tag: "Ctor", ctor: t.ctor, arity, args: [] });
        break;
      }
      case "App":
        work.push({ op: "app" }, { term: t.arg, env, self: selfDef }, { term: t.fn, env, self: selfDef });
        break;
      case "BinOp":
        work.push({ op: "bin", b: t.op }, { term: t.right, env, self: selfDef }, { term: t.left, env, self: selfDef });
        break;
      case "If":
        work.push({ op: "if", then: t.then, els: t.else, env, self: selfDef }, { term: t.cond, env, self: selfDef });
        break;
      case "Match":
        work.push({ op: "match", arms: t.arms, env, self: selfDef }, { term: t.scrutinee, env, self: selfDef });
        break;
      case "Let":
        work.push({ op: "let", name: t.name, body: t.body, env, self: selfDef }, { term: t.value, env, self: selfDef });
        break;
      case "Lam":
        vals.push({ tag: "Lam", param: t.param, body: t.body, env: new Map(env), selfDef });
        break;
      case "Foreign":
        vals.push(fromJs(new Function(`return (${t.code});`)()));
        break;
      case "Field":
        work.push({ op: "field", index: t.index }, { term: t.record, env, self: selfDef });
        break;
      case "Prim":
        vals.push({ tag: "Native", name: t.name, arity: PRIM_ARITY[t.name], args: [] });
        break;
    }
  }
  return vals[0];
}

/** Evaluate a core term. */
export function evalTerm(
  t: CoreTerm,
  env: Map<string, Value>,
  store: Store,
  registry: Registry,
  selfDef?: CoreDef,
): Value {
  return runMachine({ term: t, env, self: selfDef }, store, registry);
}
