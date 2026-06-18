import { StrandResolveError } from "../errors.ts";
import type { SurfaceArm, SurfaceDataDecl, SurfaceDef, SurfaceTerm } from "../syntax/ast.ts";
import type { Registry } from "./registry.ts";
import type { CoreDef, CoreTerm, DataDecl, Hash, MatchArm } from "./term.ts";

/** Turn a surface term into a core term. A `Name` becomes a parameter `Var`, a
 *  recursive `Self`, a data `Ctor`, or a `Ref(hash)` — in that order. */
export function resolveTerm(
  t: SurfaceTerm,
  params: Set<string>,
  names: Map<string, Hash>,
  registry: Registry,
  self?: string,
  group?: Map<string, number>,
): CoreTerm {
  const rec = (s: SurfaceTerm, ps: Set<string>): CoreTerm => resolveTerm(s, ps, names, registry, self, group);
  switch (t.tag) {
    case "IntLit":
      return { tag: "IntLit", value: t.value };
    case "BoolLit":
      return { tag: "BoolLit", value: t.value };
    case "TextLit":
      return { tag: "TextLit", value: t.value };
    case "Name": {
      if (params.has(t.name)) return { tag: "Var", name: t.name };
      if (group && group.has(t.name)) return { tag: "Cyc", index: group.get(t.name)! };
      if (self !== undefined && t.name === self) return { tag: "Self" };
      const c = registry.ctors.get(t.name);
      if (c) return { tag: "Ctor", type: c.decl.name, ctor: t.name };
      const h = names.get(t.name);
      if (!h) throw new StrandResolveError(`unknown name '${t.name}'`);
      return { tag: "Ref", hash: h };
    }
    case "App":
      return { tag: "App", fn: rec(t.fn, params), arg: rec(t.arg, params) };
    case "BinOp":
      return { tag: "BinOp", op: t.op, left: rec(t.left, params), right: rec(t.right, params) };
    case "If":
      return { tag: "If", cond: rec(t.cond, params), then: rec(t.then, params), else: rec(t.else, params) };
    case "Match":
      return {
        tag: "Match",
        scrutinee: rec(t.scrutinee, params),
        arms: t.arms.map((a) => resolveArm(a, params, names, registry, self, group)),
      };
    case "Let":
      return { tag: "Let", name: t.name, value: rec(t.value, params), body: rec(t.body, new Set([...params, t.name])) };
    case "Lam":
      return { tag: "Lam", param: t.param, paramTy: t.paramTy, body: rec(t.body, new Set([...params, t.param])) };
  }
}

function resolveArm(
  arm: SurfaceArm,
  params: Set<string>,
  names: Map<string, Hash>,
  registry: Registry,
  self: string | undefined,
  group: Map<string, number> | undefined,
): MatchArm {
  if (arm.ctor === "_") {
    if (arm.vars.length > 0) throw new StrandResolveError("wildcard pattern '_' takes no variables");
    return { ctor: "_", vars: [], body: resolveTerm(arm.body, params, names, registry, self, group) };
  }
  const c = registry.ctors.get(arm.ctor);
  if (!c) throw new StrandResolveError(`unknown constructor '${arm.ctor}'`);
  if (arm.vars.length !== c.ctor.fields.length) {
    throw new StrandResolveError(`constructor '${arm.ctor}' takes ${c.ctor.fields.length} fields, got ${arm.vars.length}`);
  }
  const inner = new Set([...params, ...arm.vars]);
  return { ctor: arm.ctor, vars: arm.vars, body: resolveTerm(arm.body, inner, names, registry, self, group) };
}

/** Resolve a single value definition. Its own name is in scope as `Self`. */
export function resolveDef(d: SurfaceDef, names: Map<string, Hash>, registry: Registry): CoreDef {
  const params = new Set(d.params.map((p) => p.name));
  return {
    params: d.params.map((p) => ({ name: p.name, ty: p.ty })),
    ret: d.ret,
    body: resolveTerm(d.body, params, names, registry, d.name),
  };
}

/** Resolve a member of a mutually-recursive group. References to any group
 *  member (including itself) become `Cyc` placeholders by index. */
export function resolveGroupMember(
  d: SurfaceDef,
  names: Map<string, Hash>,
  registry: Registry,
  group: Map<string, number>,
): CoreDef {
  const params = new Set(d.params.map((p) => p.name));
  return {
    params: d.params.map((p) => ({ name: p.name, ty: p.ty })),
    ret: d.ret,
    body: resolveTerm(d.body, params, names, registry, undefined, group),
  };
}

/** A `data` declaration resolves directly — its field types are already types. */
export function resolveData(d: SurfaceDataDecl): DataDecl {
  return { name: d.name, params: d.params, ctors: d.ctors.map((c) => ({ name: c.name, fields: c.fields })) };
}
