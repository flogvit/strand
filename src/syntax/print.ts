import { tyToString, type Ty } from "../core/types.ts";
import type { SurfaceDataDecl, SurfaceDef, SurfaceItem, SurfaceTerm } from "./ast.ts";

function prec(t: SurfaceTerm): number {
  switch (t.tag) {
    case "If":
    case "Match":
    case "Let":
    case "Lam":
      return 1;
    case "BinOp":
      if (t.op === "||") return 2;
      if (t.op === "&&") return 3;
      if (t.op === "==" || t.op === "<" || t.op === ">" || t.op === "<=" || t.op === ">=") return 4;
      if (t.op === "+" || t.op === "-" || t.op === "++") return 5;
      return 6;
    case "App":
      return 7;
    default:
      return 8;
  }
}

function atomType(t: Ty): string {
  return t.tag === "Fun" || (t.tag === "Con" && t.args.length > 0) ? `(${tyToString(t)})` : tyToString(t);
}

function printTerm(t: SurfaceTerm, ctx: number): string {
  const p = (s: SurfaceTerm, c: number): string => printTerm(s, c);
  const level = prec(t);
  let s: string;
  switch (t.tag) {
    case "IntLit":
      s = String(t.value);
      break;
    case "BoolLit":
      s = String(t.value);
      break;
    case "TextLit":
      s = JSON.stringify(t.value);
      break;
    case "Name":
      s = t.name;
      break;
    case "App":
      s = `${p(t.fn, 7)} ${p(t.arg, 8)}`;
      break;
    case "BinOp":
      s = `${p(t.left, level)} ${t.op} ${p(t.right, level + 1)}`;
      break;
    case "If":
      s = `if ${p(t.cond, 0)} then ${p(t.then, 0)} else ${p(t.else, 1)}`;
      break;
    case "Match":
      s = `match ${p(t.scrutinee, 0)} { ${t.arms.map((a) => `${[a.ctor, ...a.vars].join(" ")} -> ${p(a.body, 0)}`).join(" | ")} }`;
      break;
    case "Let":
      s = `let ${t.name} = ${p(t.value, 0)} in ${p(t.body, 0)}`;
      break;
    case "Lam":
      s = `fn (${t.param}: ${tyToString(t.paramTy)}) -> ${p(t.body, 0)}`;
      break;
  }
  return level < ctx ? `(${s})` : s;
}

function printDef(d: SurfaceDef): string {
  const params = d.params.map((p) => ` (${p.name}: ${tyToString(p.ty)})`).join("");
  return `def ${d.name}${params} -> ${tyToString(d.ret)} = ${printTerm(d.body, 0)}`;
}

function printData(d: SurfaceDataDecl): string {
  const head = [d.name, ...d.params].join(" ");
  const ctors = d.ctors.map((c) => [c.name, ...c.fields.map(atomType)].join(" ")).join(" | ");
  return `data ${head} = ${ctors}`;
}

/** Pretty-print a parsed program back to canonical Strand source. */
export function printProgram(items: SurfaceItem[]): string {
  return items.map((i) => (i.kind === "data" ? printData(i) : printDef(i))).join("\n\n") + "\n";
}
