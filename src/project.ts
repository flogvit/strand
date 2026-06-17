import type { Store } from "./core/store.ts";
import type { CoreTerm, DataDecl, Hash } from "./core/term.ts";
import { tyToString } from "./core/types.ts";
import type { Conflict, Namespace } from "./model.ts";

function precedence(t: CoreTerm): number {
  switch (t.tag) {
    case "If":
    case "Match":
      return 1;
    case "BinOp":
      if (t.op === "==" || t.op === "<" || t.op === ">") return 2;
      return t.op === "+" || t.op === "-" || t.op === "++" ? 3 : 4;
    case "App":
      return 5;
    default:
      return 6;
  }
}

function renderTerm(t: CoreTerm, nameOf: Map<Hash, string>, ctx: number, selfName: string): string {
  const r = (s: CoreTerm, c: number): string => renderTerm(s, nameOf, c, selfName);
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
    case "Self":
      s = selfName;
      break;
    case "Var":
      s = t.name;
      break;
    case "Ref":
      s = nameOf.get(t.hash) ?? t.hash;
      break;
    case "Ctor":
      s = t.ctor;
      break;
    case "App":
      s = `${r(t.fn, 5)} ${r(t.arg, 6)}`;
      break;
    case "BinOp":
      s = `${r(t.left, p)} ${t.op} ${r(t.right, p + 1)}`;
      break;
    case "If":
      s = `if ${r(t.cond, 0)} then ${r(t.then, 0)} else ${r(t.else, 1)}`;
      break;
    case "Match": {
      const arms = t.arms
        .map((a) => `${[a.ctor, ...a.vars].join(" ")} -> ${r(a.body, 0)}`)
        .join(" | ");
      s = `match ${r(t.scrutinee, 0)} { ${arms} }`;
      break;
    }
  }
  return p < ctx ? `(${s})` : s;
}

export function namesOf(namespace: Namespace): Map<Hash, string> {
  const m = new Map<Hash, string>();
  for (const [name, b] of namespace) m.set(b.hash, name);
  return m;
}

function renderData(decl: DataDecl): string {
  const head = [decl.name, ...decl.params].join(" ");
  const ctors = decl.ctors
    .map((c) => [c.name, ...c.fields.map((f) => (f.tag === "Con" && f.args.length ? `(${tyToString(f)})` : tyToString(f)))].join(" "))
    .join(" | ");
  return `data ${head} = ${ctors}`;
}

/** Render one stored item (value definition or data declaration) as source. */
export function renderDef(name: string, hash: Hash, store: Store, nameOf: Map<Hash, string>): string {
  const data = store.dataOf(hash);
  if (data) return renderData(data);
  const def = store.defOf(hash);
  if (!def) return `def ${name} = <missing ${hash}>`;
  const params = def.params.map((p) => `(${p.name}: ${tyToString(p.ty)})`).join(" ");
  const head = params ? `def ${name} ${params}` : `def ${name}`;
  return `${head} -> ${tyToString(def.ret)} = ${renderTerm(def.body, nameOf, 0, name)}`;
}

export function projectNamespace(namespace: Namespace, store: Store, conflicts: Conflict[] = []): string {
  const lines: string[] = ["namespace:"];
  for (const [name, b] of [...namespace].sort((a, z) => a[0].localeCompare(z[0]))) {
    const ty = store.typeOf(b.hash);
    const desc = store.dataOf(b.hash) ? "data" : ty ? tyToString(ty) : "?";
    lines.push(`  ${name.padEnd(16)} : ${desc.padEnd(20)} ${b.hash}  — ${b.intent} (${b.by})`);
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
