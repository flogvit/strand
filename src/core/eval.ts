import { StrandEvalError } from "../errors.ts";
import type { Store } from "./store.ts";
import type { BinOp, CoreDef, CoreTerm } from "./term.ts";

/** Runtime values. A partially-applied definition is a Closure carrying the
 *  arguments gathered so far. */
export type Value =
  | { tag: "Int"; value: number }
  | { tag: "Bool"; value: boolean }
  | { tag: "Text"; value: string }
  | { tag: "Closure"; def: CoreDef; applied: Value[] };

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
  }
}

function computeBinOp(op: BinOp, l: Value, r: Value): Value {
  const li = (l as { value: number }).value;
  const ri = (r as { value: number }).value;
  switch (op) {
    case "+":
      return { tag: "Int", value: li + ri };
    case "-":
      return { tag: "Int", value: li - ri };
    case "*":
      return { tag: "Int", value: li * ri };
    case "<":
      return { tag: "Bool", value: li < ri };
    case ">":
      return { tag: "Bool", value: li > ri };
    case "==":
      return { tag: "Bool", value: (l as { value: unknown }).value === (r as { value: unknown }).value };
  }
}

function apply(fn: Value, arg: Value, store: Store): Value {
  if (fn.tag !== "Closure") throw new StrandEvalError("applied a non-function value");
  const applied = [...fn.applied, arg];
  if (applied.length < fn.def.params.length) return { tag: "Closure", def: fn.def, applied };
  const env = new Map<string, Value>();
  fn.def.params.forEach((p, i) => env.set(p.name, applied[i]));
  return evalTerm(fn.def.body, env, store);
}

/** Evaluate a core term. Parameters come from `env`; definition references are
 *  fetched from the store by hash — evaluation, like typing, follows identity. */
export function evalTerm(t: CoreTerm, env: Map<string, Value>, store: Store): Value {
  switch (t.tag) {
    case "IntLit":
      return { tag: "Int", value: t.value };
    case "BoolLit":
      return { tag: "Bool", value: t.value };
    case "TextLit":
      return { tag: "Text", value: t.value };
    case "Var": {
      const v = env.get(t.name);
      if (!v) throw new StrandEvalError(`unbound variable '${t.name}'`);
      return v;
    }
    case "Ref": {
      const sd = store.get(t.hash);
      if (!sd) throw new StrandEvalError(`dangling reference ${t.hash}`);
      if (sd.def.params.length === 0) return evalTerm(sd.def.body, new Map(), store);
      return { tag: "Closure", def: sd.def, applied: [] };
    }
    case "App":
      return apply(evalTerm(t.fn, env, store), evalTerm(t.arg, env, store), store);
    case "BinOp":
      return computeBinOp(t.op, evalTerm(t.left, env, store), evalTerm(t.right, env, store));
    case "If":
      return (evalTerm(t.cond, env, store) as { value: boolean }).value
        ? evalTerm(t.then, env, store)
        : evalTerm(t.else, env, store);
  }
}
