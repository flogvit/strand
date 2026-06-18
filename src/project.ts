import type { Store } from "./core/store.ts";
import { depsOf, type CoreTerm, type DataDecl, type Hash } from "./core/term.ts";
import { tyToString } from "./core/types.ts";
import type { Conflict, Namespace } from "./model.ts";

function precedence(t: CoreTerm): number {
  switch (t.tag) {
    case "If":
    case "Match":
    case "Let":
    case "Lam":
      return 1;
    case "BinOp":
      if (t.op === "||") return 2;
      if (t.op === "&&") return 3;
      if (t.op === "==" || t.op === "<" || t.op === ">" || t.op === "<=" || t.op === ">=") return 4;
      if (t.op === "+" || t.op === "-" || t.op === "++") return 5;
      return 6; // * / %
    case "App":
      return 7;
    default:
      return 8;
  }
}

function renderTerm(t: CoreTerm, nameOf: Map<Hash, string>, ctx: number, selfName: string, groupNames: string[] = []): string {
  const r = (s: CoreTerm, c: number): string => renderTerm(s, nameOf, c, selfName, groupNames);
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
    case "Cyc":
      s = groupNames[t.index] ?? `cyc${t.index}`;
      break;
    case "Foreign":
      s = JSON.stringify(t.code);
      break;
    case "Field":
      s = `${r(t.record, 8)}.${t.field}`;
      break;
    case "Prim":
      s = t.name;
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
      s = `${r(t.fn, 7)} ${r(t.arg, 8)}`;
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
    case "Let":
      s = `let ${t.name} = ${r(t.value, 0)} in ${r(t.body, 0)}`;
      break;
    case "Lam":
      s = `fn (${t.param}: ${tyToString(t.paramTy)}) -> ${r(t.body, 0)}`;
      break;
  }
  return p < ctx ? `(${s})` : s;
}

export function namesOf(namespace: Namespace): Map<Hash, string> {
  const m = new Map<Hash, string>();
  for (const [name, b] of namespace) m.set(b.hash, name);
  return m;
}

function renderData(decl: DataDecl): string {
  const first = decl.ctors[0];
  if (decl.ctors.length === 1 && first.fieldNames) {
    const fields = first.fieldNames.map((n, i) => `${n}: ${tyToString(first.fields[i])}`).join(", ");
    return `record ${decl.name} { ${fields} }`;
  }
  const head = [decl.name, ...decl.params].join(" ");
  const ctors = decl.ctors
    .map((c) => [c.name, ...c.fields.map((f) => (f.tag === "Con" && f.args.length ? `(${tyToString(f)})` : tyToString(f)))].join(" "))
    .join(" | ");
  return `data ${head} = ${ctors}`;
}

/** Render the whole namespace as canonical Strand source — data/record/foreign
 *  declarations first, then value definitions in dependency order. This is the
 *  git-committable, human-readable projection of the content-addressed graph. */
export function exportNamespace(namespace: Namespace, store: Store): string {
  const nameOf = namesOf(namespace);
  const nameByHash = new Map([...namespace].map(([n, b]) => [b.hash, n]));

  const dataLines: string[] = [];
  const seenData = new Set<Hash>();
  for (const [name, b] of namespace) {
    if (store.dataOf(b.hash) && !seenData.has(b.hash)) {
      seenData.add(b.hash);
      dataLines.push(renderDef(name, b.hash, store, nameOf));
    }
  }

  const order: Hash[] = [];
  const seen = new Set<Hash>();
  const visit = (h: Hash): void => {
    if (seen.has(h)) return;
    seen.add(h);
    const def = store.defOf(h);
    if (!def) return;
    for (const d of depsOf(def.body)) visit(d);
    order.push(h);
  };
  for (const [, b] of namespace) if (store.defOf(b.hash)) visit(b.hash);

  const defLines = order.map((h) => renderDef(nameByHash.get(h) ?? h, h, store, nameOf));
  return [...dataLines, ...defLines].join("\n\n") + "\n";
}

/** Render one stored item (value definition or data declaration) as source. */
export function renderDef(name: string, hash: Hash, store: Store, nameOf: Map<Hash, string>): string {
  const data = store.dataOf(hash);
  if (data) return renderData(data);
  const def = store.defOf(hash);
  if (!def) return `def ${name} = <missing ${hash}>`;
  const paramList = def.params.map((p) => `(${p.name}: ${tyToString(p.ty)})`).join(" ");
  if (def.body.tag === "Foreign") {
    const kw = paramList ? `foreign ${name} ${paramList}` : `foreign ${name}`;
    return `${kw} -> ${tyToString(def.ret)} = ${JSON.stringify(def.body.code)}`;
  }
  const params = paramList;
  const head = params ? `def ${name} ${params}` : `def ${name}`;
  const groupNames = def.group ? def.group.map((h) => nameOf.get(h) ?? h) : [];
  return `${head} -> ${tyToString(def.ret)} = ${renderTerm(def.body, nameOf, 0, name, groupNames)}`;
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
