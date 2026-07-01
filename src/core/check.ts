import { StrandError } from "../errors.ts";
import type { Namespace } from "../model.ts";
import { buildRegistry } from "./registry.ts";
import type { Store } from "./store.ts";
import type { CoreDef, DataDecl } from "./term.ts";
import { typecheckDef, typecheckGroup } from "./typecheck.ts";

/** Build a registry from the data declarations a set of defs pinned by content
 *  hash (deduped). Types are referenced by identity, so a def is always checked
 *  against the exact declarations it was written against. */
function registryFor(defs: CoreDef[], store: Store) {
  const pins = [...new Set(defs.flatMap((d) => d.pins ?? []))];
  const pinned = pins.map((h) => store.dataOf(h)).filter((d): d is DataDecl => !!d);
  return buildRegistry(pinned);
}

/** Re-typecheck every value definition in a namespace. Each definition is
 *  checked against the data declarations it *pinned* at compile time (by content
 *  hash), not against whatever a type name points at now. So rebinding a type
 *  name cannot make an existing green definition red — types, like values, are
 *  referenced by identity. Mutually-recursive definitions are re-checked as a
 *  group (so their `Cyc` cross-references resolve), matching how they were first
 *  accepted at submit. Empty result == the whole namespace is green. */
export function typecheckNamespace(namespace: Namespace, store: Store): { name: string; error: string }[] {
  const errors: { name: string; error: string }[] = [];
  const checkedGroups = new Set<string>();
  for (const [name, b] of namespace) {
    const def = store.defOf(b.hash);
    if (!def) continue;
    try {
      if (def.group && def.group.length > 1) {
        // A mutual group: check all members together, once.
        const key = def.group.join(",");
        if (checkedGroups.has(key)) continue;
        checkedGroups.add(key);
        const members = def.group.map((h) => store.defOf(h)).filter((d): d is CoreDef => !!d);
        if (members.length !== def.group.length) {
          errors.push({ name, error: "mutual group is missing a member in the store" });
          continue;
        }
        typecheckGroup(members, store, registryFor(members, store));
      } else {
        typecheckDef(def, store, registryFor([def], store));
      }
    } catch (e) {
      if (e instanceof StrandError) errors.push({ name, error: e.message });
      else throw e;
    }
  }
  return errors;
}
