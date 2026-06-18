import type { Ty } from "./types.ts";

export type Hash = string; // e.g. "#7f3a1b2c"

export type BinOp =
  | "+"
  | "-"
  | "*"
  | "/"
  | "%"
  | "=="
  | "<"
  | ">"
  | "<="
  | ">="
  | "&&"
  | "||"
  | "++";

/** One arm of a `match`: a constructor name, the variables it binds to the
 *  constructor's fields, and the body to evaluate when it matches. */
export interface MatchArm {
  ctor: string;
  vars: string[];
  body: CoreTerm;
}

/** The core term language. References to other value definitions are by
 *  identity (`Ref` carries a hash); constructors and types are referenced by
 *  name (resolved against the data registry). */
export type CoreTerm =
  | { tag: "IntLit"; value: number }
  | { tag: "BoolLit"; value: boolean }
  | { tag: "TextLit"; value: string }
  | { tag: "Var"; name: string }
  | { tag: "Ref"; hash: Hash }
  | { tag: "App"; fn: CoreTerm; arg: CoreTerm }
  | { tag: "BinOp"; op: BinOp; left: CoreTerm; right: CoreTerm }
  | { tag: "If"; cond: CoreTerm; then: CoreTerm; else: CoreTerm }
  | { tag: "Self" }
  | { tag: "Cyc"; index: number } // a reference to the index-th member of the current recursive group
  | { tag: "Ctor"; type: string; ctor: string }
  | { tag: "Match"; scrutinee: CoreTerm; arms: MatchArm[] }
  | { tag: "Let"; name: string; value: CoreTerm; body: CoreTerm }
  | { tag: "Lam"; param: string; paramTy: Ty; body: CoreTerm }
  | { tag: "Foreign"; code: string } // a trusted raw TypeScript expression (body of a foreign def)
  | { tag: "Field"; record: CoreTerm; field: string; index: number } // record field access (index filled by typecheck)
  | { tag: "Prim"; name: string }; // a built-in primitive (IO)

export interface Param {
  name: string;
  ty: Ty;
}

export interface CoreDef {
  params: Param[];
  ret: Ty;
  body: CoreTerm;
  /** For a member of a mutually-recursive group: the hashes of all group
   *  members (including this one), indexed as the body's `Cyc` nodes expect.
   *  Post-hoc metadata — not part of the content hash. */
  group?: Hash[];
  /** The content hashes of the data declarations this definition's types and
   *  constructors reference, pinned at compile time. Re-checking against these
   *  (rather than against whatever a type name points at now) gives types
   *  reference-by-identity. Post-hoc metadata — not part of the content hash. */
  pins?: Hash[];
}

export interface CtorDecl {
  name: string;
  fields: Ty[];
  /** Field names, for record-style (single-constructor) data types. */
  fieldNames?: string[];
}

/** A `data` declaration: a type constructor with parameters and value
 *  constructors. References to other types inside `fields` are by name. */
export interface DataDecl {
  name: string;
  params: string[];
  ctors: CtorDecl[];
}

/** The value-definition hashes a term references (constructors and types are
 *  not value refs, so they do not appear here). */
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
      case "Match":
        walk(t.scrutinee);
        t.arms.forEach((a) => walk(a.body));
        break;
      case "Let":
        walk(t.value);
        walk(t.body);
        break;
      case "Lam":
        walk(t.body);
        break;
      case "Field":
        walk(t.record);
        break;
      default:
        break;
    }
  };
  walk(term);
  return [...out];
}
