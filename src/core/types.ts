/** Strand's type language: ground types, curried functions, type constructors
 *  (e.g. `List a`, `Option Int`), rigid type variables, and — during checking
 *  only — flexible unification variables. */
export type Ty =
  | { tag: "Int" }
  | { tag: "Bool" }
  | { tag: "Text" }
  | { tag: "Fun"; from: Ty; to: Ty }
  | { tag: "Con"; name: string; args: Ty[] }
  | { tag: "Var"; name: string }
  | { tag: "Flex"; id: number };

export const tInt: Ty = { tag: "Int" };
export const tBool: Ty = { tag: "Bool" };
export const tText: Ty = { tag: "Text" };
export const tFun = (from: Ty, to: Ty): Ty => ({ tag: "Fun", from, to });
export const tCon = (name: string, args: Ty[] = []): Ty => ({ tag: "Con", name, args });
export const tVar = (name: string): Ty => ({ tag: "Var", name });

/** Build a curried function type from a parameter list and a return type. */
export function tyOfSignature(params: Ty[], ret: Ty): Ty {
  return params.reduceRight<Ty>((acc, p) => tFun(p, acc), ret);
}

function atom(t: Ty): string {
  return t.tag === "Fun" || (t.tag === "Con" && t.args.length > 0) ? `(${tyToString(t)})` : tyToString(t);
}

export function tyToString(t: Ty): string {
  switch (t.tag) {
    case "Int":
      return "Int";
    case "Bool":
      return "Bool";
    case "Text":
      return "Text";
    case "Var":
      return t.name;
    case "Flex":
      return `?${t.id}`;
    case "Con":
      return t.args.length ? `${t.name} ${t.args.map(atom).join(" ")}` : t.name;
    case "Fun": {
      const f = t.from.tag === "Fun" ? `(${tyToString(t.from)})` : tyToString(t.from);
      return `${f} -> ${tyToString(t.to)}`;
    }
  }
}

/** The names of the (rigid) type variables occurring in a type. */
export function freeVarNames(t: Ty, into: Set<string> = new Set()): Set<string> {
  switch (t.tag) {
    case "Var":
      into.add(t.name);
      break;
    case "Fun":
      freeVarNames(t.from, into);
      freeVarNames(t.to, into);
      break;
    case "Con":
      t.args.forEach((a) => freeVarNames(a, into));
      break;
    default:
      break;
  }
  return into;
}

/** Structural equality, treating type variables nominally. Used where no
 *  unification is needed (e.g. comparing two fully-resolved ground types). */
export function tyEqual(a: Ty, b: Ty): boolean {
  if (a.tag !== b.tag) return false;
  switch (a.tag) {
    case "Fun":
      return tyEqual(a.from, (b as typeof a).from) && tyEqual(a.to, (b as typeof a).to);
    case "Con": {
      const bb = b as typeof a;
      return a.name === bb.name && a.args.length === bb.args.length && a.args.every((x, i) => tyEqual(x, bb.args[i]));
    }
    case "Var":
      return a.name === (b as typeof a).name;
    case "Flex":
      return a.id === (b as typeof a).id;
    default:
      return true;
  }
}
