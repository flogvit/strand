import ts from "typescript";

export type DefKind = "function" | "const" | "type";

/** One top-level TypeScript definition, lifted out so Strand can address it by
 *  content and track who depends on it. `text` is canonically printed (so two
 *  functionally identical defs that differ only in whitespace/comments-layout
 *  hash the same); `deps` are the other top-level names it references. */
export interface TsDef {
  name: string;
  kind: DefKind;
  text: string;
  deps: string[];
}

const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });

function declaredNames(sf: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name) names.add(st.name.text);
    else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name)) names.add(d.name.text);
    } else if (ts.isTypeAliasDeclaration(st) || ts.isInterfaceDeclaration(st)) names.add(st.name.text);
  }
  return names;
}

/** Identifiers referenced inside a node that name other tracked top-level defs.
 *  Property names (the `b` in `a.b`) are not references to a top-level name. */
function referencedNames(node: ts.Node, universe: Set<string>, self: string): string[] {
  const found = new Set<string>();
  const walk = (n: ts.Node): void => {
    if (ts.isPropertyAccessExpression(n)) {
      walk(n.expression);
      return; // skip the property name
    }
    if (ts.isIdentifier(n) && n.text !== self && universe.has(n.text)) found.add(n.text);
    ts.forEachChild(n, walk);
  };
  ts.forEachChild(node, walk);
  return [...found];
}

function entryFor(st: ts.Statement, sf: ts.SourceFile, universe: Set<string>): TsDef[] {
  const text = printer.printNode(ts.EmitHint.Unspecified, st, sf).trim();
  if (ts.isFunctionDeclaration(st) && st.name) {
    const name = st.name.text;
    return [{ name, kind: "function", text, deps: referencedNames(st, universe, name) }];
  }
  if (ts.isVariableStatement(st)) {
    return st.declarationList.declarations.flatMap((d) => {
      if (!ts.isIdentifier(d.name)) return [];
      const name = d.name.text;
      return [{ name, kind: "const" as const, text, deps: referencedNames(st, universe, name) }];
    });
  }
  if (ts.isTypeAliasDeclaration(st) || ts.isInterfaceDeclaration(st)) {
    const name = st.name.text;
    return [{ name, kind: "type", text, deps: referencedNames(st, universe, name) }];
  }
  return [];
}

/** Lift every top-level definition out of a TypeScript source string. */
export function extractDefs(source: string): TsDef[] {
  const sf = ts.createSourceFile("module.ts", source, ts.ScriptTarget.ES2022, true);
  const universe = declaredNames(sf);
  return sf.statements.flatMap((st) => entryFor(st, sf, universe));
}
