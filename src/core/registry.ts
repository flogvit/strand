import type { CtorDecl, DataDecl } from "./term.ts";

/** A lookup table over the data declarations in scope: types by name, and each
 *  constructor by name (with its declaring type and positional tag). */
export interface Registry {
  types: Map<string, DataDecl>;
  ctors: Map<string, { decl: DataDecl; ctor: CtorDecl; tag: number }>;
}

export function buildRegistry(decls: DataDecl[]): Registry {
  const types = new Map<string, DataDecl>();
  const ctors = new Map<string, { decl: DataDecl; ctor: CtorDecl; tag: number }>();
  for (const d of decls) {
    types.set(d.name, d);
    d.ctors.forEach((c, tag) => ctors.set(c.name, { decl: d, ctor: c, tag }));
  }
  return { types, ctors };
}

export const emptyRegistry = (): Registry => buildRegistry([]);
