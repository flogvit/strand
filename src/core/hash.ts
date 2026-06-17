import { createHash } from "node:crypto";
import type { CoreDef, CoreTerm, Hash } from "./term.ts";
import { tyToString } from "./types.ts";

/** Rewrite a term into a canonical shape for hashing: parameter names are
 *  replaced by positional placeholders ($0, $1, …) so that two definitions
 *  that differ only in what they call their parameters hash identically
 *  (alpha-equivalence). Dependency hashes are kept verbatim. */
function canonicalTerm(t: CoreTerm, rename: Map<string, string>): unknown {
  switch (t.tag) {
    case "Var":
      return { tag: "Var", name: rename.get(t.name) ?? t.name };
    case "Ref":
      return { tag: "Ref", hash: t.hash };
    case "App":
      return { tag: "App", fn: canonicalTerm(t.fn, rename), arg: canonicalTerm(t.arg, rename) };
    case "BinOp":
      return {
        tag: "BinOp",
        op: t.op,
        left: canonicalTerm(t.left, rename),
        right: canonicalTerm(t.right, rename),
      };
    case "If":
      return {
        tag: "If",
        cond: canonicalTerm(t.cond, rename),
        then: canonicalTerm(t.then, rename),
        else: canonicalTerm(t.else, rename),
      };
    default:
      return t; // literals are already canonical
  }
}

/** Content address of a definition: a hash over its *structure* (parameter
 *  types, return type, body) — deliberately not its name or the human intent
 *  attached to a binding. Two agents who independently write the same logic
 *  land on the same hash, so their work converges instead of conflicting. */
export function hashOf(def: CoreDef): Hash {
  const rename = new Map<string, string>();
  def.params.forEach((p, i) => rename.set(p.name, `$${i}`));
  const canonical = JSON.stringify({
    params: def.params.map((p, i) => ({ name: `$${i}`, ty: tyToString(p.ty) })),
    ret: tyToString(def.ret),
    body: canonicalTerm(def.body, rename),
  });
  return "#" + createHash("sha256").update(canonical).digest("hex").slice(0, 8);
}
