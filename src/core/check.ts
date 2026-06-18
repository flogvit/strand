import { StrandError } from "../errors.ts";
import type { Namespace } from "../model.ts";
import { buildRegistry } from "./registry.ts";
import type { Store } from "./store.ts";
import type { DataDecl } from "./term.ts";
import { typecheckDef } from "./typecheck.ts";

/** Re-typecheck every value definition in a namespace. Each definition is
 *  checked against the data declarations it *pinned* at compile time (by content
 *  hash), not against whatever a type name points at now. So rebinding a type
 *  name cannot make an existing green definition red — types, like values, are
 *  referenced by identity. Empty result == the whole namespace is green. */
export function typecheckNamespace(namespace: Namespace, store: Store): { name: string; error: string }[] {
  const errors: { name: string; error: string }[] = [];
  for (const [name, b] of namespace) {
    const def = store.defOf(b.hash);
    if (!def) continue;
    const pinned = (def.pins ?? []).map((h) => store.dataOf(h)).filter((d): d is DataDecl => !!d);
    const registry = buildRegistry(pinned);
    try {
      typecheckDef(def, store, registry);
    } catch (e) {
      if (e instanceof StrandError) errors.push({ name, error: e.message });
      else throw e;
    }
  }
  return errors;
}
