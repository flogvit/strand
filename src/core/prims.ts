import { tCon, tFun, tText, tVar, type Ty } from "./types.ts";

const tIO = (a: Ty): Ty => tCon("IO", [a]);
const tUnit: Ty = tCon("Unit", []);

/** Built-in primitive type schemes — a minimal IO monad.
 *  print   : Text -> IO Unit
 *  pure    : a -> IO a
 *  andThen : IO a -> (a -> IO b) -> IO b */
export const PRIMS: Record<string, Ty> = {
  print: tFun(tText, tIO(tUnit)),
  pure: tFun(tVar("a"), tIO(tVar("a"))),
  andThen: tFun(tIO(tVar("a")), tFun(tFun(tVar("a"), tIO(tVar("b"))), tIO(tVar("b")))),
};

export const PRIM_ARITY: Record<string, number> = { print: 1, pure: 1, andThen: 2 };
