/** Strand's type language: three ground types and curried functions. */
export type Ty =
  | { tag: "Int" }
  | { tag: "Bool" }
  | { tag: "Text" }
  | { tag: "Fun"; from: Ty; to: Ty };

export const tInt: Ty = { tag: "Int" };
export const tBool: Ty = { tag: "Bool" };
export const tText: Ty = { tag: "Text" };
export const tFun = (from: Ty, to: Ty): Ty => ({ tag: "Fun", from, to });

export function tyEqual(a: Ty, b: Ty): boolean {
  if (a.tag !== b.tag) return false;
  if (a.tag === "Fun" && b.tag === "Fun") {
    return tyEqual(a.from, b.from) && tyEqual(a.to, b.to);
  }
  return true;
}

export function tyToString(t: Ty): string {
  switch (t.tag) {
    case "Int":
      return "Int";
    case "Bool":
      return "Bool";
    case "Text":
      return "Text";
    case "Fun": {
      const from = t.from.tag === "Fun" ? `(${tyToString(t.from)})` : tyToString(t.from);
      return `${from} -> ${tyToString(t.to)}`;
    }
  }
}

/** Build a curried function type from a parameter list and a return type. */
export function tyOfSignature(params: Ty[], ret: Ty): Ty {
  return params.reduceRight<Ty>((acc, p) => tFun(p, acc), ret);
}
