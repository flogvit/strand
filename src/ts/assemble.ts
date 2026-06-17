import type { Namespace } from "./model.ts";
import type { TsStore } from "./store.ts";

/** Concatenate the namespace's definitions into one TypeScript module, in
 *  dependency order (a definition appears before the ones that use it). This is
 *  the module humans review and the compiler type-checks. */
export function assemble(namespace: Namespace, store: TsStore): string {
  const order: string[] = [];
  const seen = new Set<string>();
  const visit = (name: string): void => {
    if (seen.has(name)) return;
    seen.add(name);
    const b = namespace.get(name);
    if (!b) return;
    const def = store.get(b.hash);
    if (!def) return;
    for (const dep of def.deps) if (namespace.has(dep)) visit(dep);
    order.push(name);
  };
  for (const name of namespace.keys()) visit(name);

  return order.map((n) => store.get(namespace.get(n)!.hash)!.text).join("\n\n") + "\n";
}
