import { StrandError } from "../errors.ts";
import type { Namespace } from "../model.ts";
import { buildRegistry } from "./registry.ts";
import type { Store } from "./store.ts";
import type { DataDecl } from "./term.ts";
import { typecheckDef } from "./typecheck.ts";

/** Re-typecheck every value definition in a namespace against the namespace's
 *  *current* type registry. Because value references are by content hash, a
 *  merge can never make a green definition red through its value deps — but a
 *  type is referenced by name, so rebinding a type name (e.g. two agents redefine
 *  `Color`) can. This catches exactly that: the cross-definition breakage that a
 *  per-submission check cannot see. Empty result == the whole namespace is green. */
export function typecheckNamespace(namespace: Namespace, store: Store): { name: string; error: string }[] {
  const decls: DataDecl[] = [];
  const seen = new Set<string>();
  for (const b of namespace.values()) {
    const d = store.dataOf(b.hash);
    if (d && !seen.has(b.hash)) {
      seen.add(b.hash);
      decls.push(d);
    }
  }
  const registry = buildRegistry(decls);

  const errors: { name: string; error: string }[] = [];
  for (const [name, b] of namespace) {
    const def = store.defOf(b.hash);
    if (!def) continue;
    try {
      typecheckDef(def, store, registry);
    } catch (e) {
      if (e instanceof StrandError) errors.push({ name, error: e.message });
      else throw e;
    }
  }
  return errors;
}
