import type { Store } from "./core/store.ts";
import type { CoreTerm, Hash } from "./core/term.ts";
import { tyToString } from "./core/types.ts";
import type { Conflict, Namespace } from "./model.ts";

function precedence(t: CoreTerm): number {
  switch (t.tag) {
    case "If":
      return 1;
    case "BinOp":
      if (t.op === "==" || t.op === "<" || t.op === ">") return 2;
      return t.op === "+" || t.op === "-" ? 3 : 4;
    case "App":
      return 5;
    default:
      return 6;
  }
}

function renderTerm(t: CoreTerm, nameOf: Map<Hash, string>, ctx: number): string {
  const p = precedence(t);
  let s: string;
  switch (t.tag) {
    case "IntLit":
      s = String(t.value);
      break;
    case "BoolLit":
      s = String(t.value);
      break;
    case "TextLit":
      s = JSON.stringify(t.value);
      break;
    case "Var":
      s = t.name;
      break;
    case "Ref":
      s = nameOf.get(t.hash) ?? t.hash;
      break;
    case "App":
      s = `${renderTerm(t.fn, nameOf, 5)} ${renderTerm(t.arg, nameOf, 6)}`;
      break;
    case "BinOp":
      s = `${renderTerm(t.left, nameOf, p)} ${t.op} ${renderTerm(t.right, nameOf, p + 1)}`;
      break;
    case "If":
      s = `if ${renderTerm(t.cond, nameOf, 0)} then ${renderTerm(t.then, nameOf, 0)} else ${renderTerm(t.else, nameOf, 1)}`;
      break;
  }
  return p < ctx ? `(${s})` : s;
}

/** Build a reverse map hash -> name from a namespace, so references render as
 *  the name a reader knows rather than a raw hash. */
export function namesOf(namespace: Namespace): Map<Hash, string> {
  const m = new Map<Hash, string>();
  for (const [name, b] of namespace) m.set(b.hash, name);
  return m;
}

/** Render one definition back to readable Strand source. */
export function renderDef(name: string, hash: Hash, store: Store, nameOf: Map<Hash, string>): string {
  const sd = store.get(hash);
  if (!sd) return `def ${name} = <missing ${hash}>`;
  const params = sd.def.params.map((p) => `(${p.name}: ${tyToString(p.ty)})`).join(" ");
  const head = params ? `def ${name} ${params}` : `def ${name}`;
  return `${head} -> ${tyToString(sd.def.ret)} = ${renderTerm(sd.def.body, nameOf, 0)}`;
}

/** A readable projection of a whole namespace: name, type, intent, author —
 *  plus any parked conflicts. This is the human plane. */
export function projectNamespace(namespace: Namespace, store: Store, conflicts: Conflict[] = []): string {
  const lines: string[] = ["namespace:"];
  for (const [name, b] of [...namespace].sort((a, z) => a[0].localeCompare(z[0]))) {
    const ty = store.typeOf(b.hash);
    lines.push(`  ${name.padEnd(16)} : ${(ty ? tyToString(ty) : "?").padEnd(18)} ${b.hash}  — ${b.intent} (${b.by})`);
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
