import type { BinOp } from "../core/term.ts";
import type { Ty } from "../core/types.ts";

/** Surface syntax: what an agent or human actually writes. References are by
 *  NAME here (`Name`); the resolver later turns each name into either a
 *  parameter `Var` or a definition `Ref(hash)`. */
export type SurfaceTerm =
  | { tag: "IntLit"; value: number }
  | { tag: "BoolLit"; value: boolean }
  | { tag: "TextLit"; value: string }
  | { tag: "Name"; name: string }
  | { tag: "App"; fn: SurfaceTerm; arg: SurfaceTerm }
  | { tag: "BinOp"; op: BinOp; left: SurfaceTerm; right: SurfaceTerm }
  | { tag: "If"; cond: SurfaceTerm; then: SurfaceTerm; else: SurfaceTerm };

export interface SurfaceParam {
  name: string;
  ty: Ty;
}

export interface SurfaceDef {
  name: string;
  params: SurfaceParam[];
  ret: Ty;
  body: SurfaceTerm;
}
