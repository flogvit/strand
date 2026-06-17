import type { Ty } from "./types.ts";

export type Hash = string; // e.g. "#7f3a1b2c"

export type BinOp = "+" | "-" | "*" | "==" | "<" | ">";

/** The core term language. References to other definitions are by identity
 *  (`Ref` carries a content hash), never by name — names live only in the
 *  namespace. Parameters are referenced by `Var`. */
export type CoreTerm =
  | { tag: "IntLit"; value: number }
  | { tag: "BoolLit"; value: boolean }
  | { tag: "TextLit"; value: string }
  | { tag: "Var"; name: string }
  | { tag: "Ref"; hash: Hash }
  | { tag: "App"; fn: CoreTerm; arg: CoreTerm }
  | { tag: "BinOp"; op: BinOp; left: CoreTerm; right: CoreTerm }
  | { tag: "If"; cond: CoreTerm; then: CoreTerm; else: CoreTerm };

export interface Param {
  name: string;
  ty: Ty;
}

/** A definition's content: its curried parameters, declared return type, and
 *  body. This is what gets content-addressed — the name it is bound to is NOT
 *  part of it. */
export interface CoreDef {
  params: Param[];
  ret: Ty;
  body: CoreTerm;
}

/** The set of definition hashes a term references. */
export function depsOf(term: CoreTerm): Hash[] {
  const out = new Set<Hash>();
  const walk = (t: CoreTerm): void => {
    switch (t.tag) {
      case "Ref":
        out.add(t.hash);
        break;
      case "App":
        walk(t.fn);
        walk(t.arg);
        break;
      case "BinOp":
        walk(t.left);
        walk(t.right);
        break;
      case "If":
        walk(t.cond);
        walk(t.then);
        walk(t.else);
        break;
      default:
        break;
    }
  };
  walk(term);
  return [...out];
}
