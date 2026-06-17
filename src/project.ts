import type { Conflict, Namespace } from "./model.ts";

/** The human plane: a faithful, readable projection of a namespace. Humans
 *  review this plus intent — never raw hashes. Minimal in this wedge, but it is
 *  the seam where a richer renderer (real source syntax) would later plug in. */
export function project(namespace: Namespace, conflicts: Conflict[] = []): string {
  const lines: string[] = ["namespace:"];
  for (const [name, b] of [...namespace].sort((a, z) => a[0].localeCompare(z[0]))) {
    lines.push(`  ${name.padEnd(16)} ${b.hash}  — ${b.intent} (${b.by})`);
  }
  if (conflicts.length) {
    lines.push("", "parked conflicts:");
    for (const c of conflicts) {
      lines.push(`  ${c.name}  (base ${c.base ?? "∅"})`);
      for (const k of c.contenders) lines.push(`     ↳ ${k.by}: ${k.hash} — ${k.intent}`);
    }
  }
  return lines.join("\n");
}
