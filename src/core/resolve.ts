import { StrandResolveError } from "../errors.ts";
import type { SurfaceDef, SurfaceTerm } from "../syntax/ast.ts";
import type { CoreDef, CoreTerm, Hash } from "./term.ts";

/** Turn a surface term into a core term: every `Name` becomes either a `Var`
 *  (if it is one of the enclosing parameters) or a `Ref(hash)` resolved against
 *  the namespace. Unknown names are an error — this is where "reference by
 *  identity" is established. */
export function resolveTerm(t: SurfaceTerm, params: Set<string>, names: Map<string, Hash>): CoreTerm {
  switch (t.tag) {
    case "IntLit":
      return { tag: "IntLit", value: t.value };
    case "BoolLit":
      return { tag: "BoolLit", value: t.value };
    case "TextLit":
      return { tag: "TextLit", value: t.value };
    case "Name": {
      if (params.has(t.name)) return { tag: "Var", name: t.name };
      const h = names.get(t.name);
      if (!h) throw new StrandResolveError(`unknown name '${t.name}'`);
      return { tag: "Ref", hash: h };
    }
    case "App":
      return { tag: "App", fn: resolveTerm(t.fn, params, names), arg: resolveTerm(t.arg, params, names) };
    case "BinOp":
      return {
        tag: "BinOp",
        op: t.op,
        left: resolveTerm(t.left, params, names),
        right: resolveTerm(t.right, params, names),
      };
    case "If":
      return {
        tag: "If",
        cond: resolveTerm(t.cond, params, names),
        then: resolveTerm(t.then, params, names),
        else: resolveTerm(t.else, params, names),
      };
  }
}

/** Resolve a whole definition. The new definition's own name is intentionally
 *  not in scope: recursion is out of scope for v1 because a self-reference
 *  would make the content hash ill-founded (its hash would depend on itself). */
export function resolveDef(d: SurfaceDef, names: Map<string, Hash>): CoreDef {
  const params = new Set(d.params.map((p) => p.name));
  return {
    params: d.params.map((p) => ({ name: p.name, ty: p.ty })),
    ret: d.ret,
    body: resolveTerm(d.body, params, names),
  };
}
