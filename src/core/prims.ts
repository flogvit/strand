import { tCon, tFun, tInt, tText, tVar, type Ty } from "./types.ts";

const tIO = (a: Ty): Ty => tCon("IO", [a]);
const tUnit: Ty = tCon("Unit", []);

/** Built-in primitive type schemes.
 *
 *  A minimal IO monad:
 *   print   : Text -> IO Unit
 *   pure    : a -> IO a
 *   andThen : IO a -> (a -> IO b) -> IO b
 *
 *  Text inspection — total functions (an out-of-range read is "", never a
 *  crash), so primitives never need Option:
 *   textLength : Text -> Int                 # character (UTF-16 unit) count
 *   charAt     : Int -> Text -> Text         # one character, or "" out of range
 *   substring  : Int -> Int -> Text -> Text  # [start, end), clamped
 *   intToText  : Int -> Text                 # base-10 rendering */
export const PRIMS: Record<string, Ty> = {
  print: tFun(tText, tIO(tUnit)),
  pure: tFun(tVar("a"), tIO(tVar("a"))),
  andThen: tFun(tIO(tVar("a")), tFun(tFun(tVar("a"), tIO(tVar("b"))), tIO(tVar("b")))),
  textLength: tFun(tText, tInt),
  charAt: tFun(tInt, tFun(tText, tText)),
  substring: tFun(tInt, tFun(tInt, tFun(tText, tText))),
  intToText: tFun(tInt, tText),
};

export const PRIM_ARITY: Record<string, number> = {
  print: 1,
  pure: 1,
  andThen: 2,
  textLength: 1,
  charAt: 2,
  substring: 3,
  intToText: 1,
};
