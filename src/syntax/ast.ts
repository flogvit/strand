import type { BinOp } from "../core/term.ts";
import type { Ty } from "../core/types.ts";

/** Surface syntax. References are by NAME; the resolver decides whether each
 *  name is a parameter, a recursive self-reference, a data constructor, or a
 *  reference to another definition. */
export type SurfaceTerm =
  | { tag: "IntLit"; value: number }
  | { tag: "BoolLit"; value: boolean }
  | { tag: "TextLit"; value: string }
  | { tag: "Name"; name: string }
  | { tag: "App"; fn: SurfaceTerm; arg: SurfaceTerm }
  | { tag: "BinOp"; op: BinOp; left: SurfaceTerm; right: SurfaceTerm }
  | { tag: "If"; cond: SurfaceTerm; then: SurfaceTerm; else: SurfaceTerm }
  | { tag: "Match"; scrutinee: SurfaceTerm; arms: SurfaceArm[] }
  | { tag: "Let"; name: string; value: SurfaceTerm; body: SurfaceTerm }
  | { tag: "Lam"; param: string; paramTy: Ty; body: SurfaceTerm }
  | { tag: "Field"; record: SurfaceTerm; field: string };

export interface SurfaceArm {
  ctor: string;
  vars: string[];
  body: SurfaceTerm;
}

export interface SurfaceParam {
  name: string;
  ty?: Ty; // optional — inferred when omitted
}

export interface SurfaceDef {
  kind: "def";
  name: string;
  params: SurfaceParam[];
  ret?: Ty; // optional — inferred when omitted
  body: SurfaceTerm;
}

export interface SurfaceDataDecl {
  kind: "data";
  name: string;
  params: string[];
  ctors: { name: string; fields: Ty[] }[];
}

/** A foreign declaration: a trusted binding to a raw TypeScript expression. */
export interface SurfaceForeign {
  kind: "foreign";
  name: string;
  params: SurfaceParam[];
  ret: Ty;
  code: string;
}

/** A record: sugar for a single-constructor data type with named fields. */
export interface SurfaceRecord {
  kind: "record";
  name: string;
  fields: { name: string; ty: Ty }[];
}

export type SurfaceItem = SurfaceDef | SurfaceDataDecl | SurfaceForeign | SurfaceRecord;
