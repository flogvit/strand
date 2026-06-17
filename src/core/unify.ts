import { StrandTypeError } from "../errors.ts";
import { freeVarNames, tCon, tFun, tyToString, type Ty } from "./types.ts";

let flexCounter = 0;

/** A fresh flexible (unification) variable. */
export function freshFlex(): Ty {
  return { tag: "Flex", id: flexCounter++ };
}

/** Substitute type variables by name. */
export function substVars(t: Ty, m: Map<string, Ty>): Ty {
  switch (t.tag) {
    case "Var":
      return m.get(t.name) ?? t;
    case "Fun":
      return tFun(substVars(t.from, m), substVars(t.to, m));
    case "Con":
      return tCon(t.name, t.args.map((a) => substVars(a, m)));
    default:
      return t;
  }
}

/** Instantiate a type scheme: replace each rigid type variable with a fresh
 *  flexible variable. Used at every *use* site of a polymorphic thing (a
 *  reference to another definition, or a data constructor). */
export function instantiate(t: Ty): Ty {
  const names = [...freeVarNames(t)];
  if (names.length === 0) return t;
  return substVars(t, new Map(names.map((n) => [n, freshFlex()])));
}

/** Mutable unification state for one type-checking pass. */
export class Unifier {
  private subst = new Map<number, Ty>();

  /** Follow flex-variable bindings to the current representative. */
  prune(t: Ty): Ty {
    if (t.tag === "Flex") {
      const bound = this.subst.get(t.id);
      if (bound) {
        const p = this.prune(bound);
        this.subst.set(t.id, p);
        return p;
      }
    }
    return t;
  }

  private occurs(id: number, t: Ty): boolean {
    const p = this.prune(t);
    switch (p.tag) {
      case "Flex":
        return p.id === id;
      case "Fun":
        return this.occurs(id, p.from) || this.occurs(id, p.to);
      case "Con":
        return p.args.some((a) => this.occurs(id, a));
      default:
        return false;
    }
  }

  unify(a: Ty, b: Ty): void {
    a = this.prune(a);
    b = this.prune(b);
    if (a.tag === "Flex" && b.tag === "Flex" && a.id === b.id) return;
    if (a.tag === "Flex") {
      if (this.occurs(a.id, b)) throw new StrandTypeError("infinite type");
      this.subst.set(a.id, b);
      return;
    }
    if (b.tag === "Flex") {
      if (this.occurs(b.id, a)) throw new StrandTypeError("infinite type");
      this.subst.set(b.id, a);
      return;
    }
    if (a.tag !== b.tag) {
      throw new StrandTypeError(`cannot unify ${tyToString(a)} with ${tyToString(b)}`);
    }
    switch (a.tag) {
      case "Fun": {
        const bb = b as typeof a;
        this.unify(a.from, bb.from);
        this.unify(a.to, bb.to);
        return;
      }
      case "Con": {
        const bb = b as typeof a;
        if (a.name !== bb.name || a.args.length !== bb.args.length) {
          throw new StrandTypeError(`cannot unify ${tyToString(a)} with ${tyToString(b)}`);
        }
        a.args.forEach((x, i) => this.unify(x, bb.args[i]));
        return;
      }
      case "Var": {
        const bb = b as typeof a;
        if (a.name !== bb.name) throw new StrandTypeError(`cannot unify rigid type ${a.name} with ${tyToString(b)}`);
        return;
      }
      default:
        return; // Int/Bool/Text: same tag is enough
    }
  }

  /** Resolve a type fully against the current substitution. */
  zonk(t: Ty): Ty {
    const p = this.prune(t);
    switch (p.tag) {
      case "Fun":
        return tFun(this.zonk(p.from), this.zonk(p.to));
      case "Con":
        return tCon(p.name, p.args.map((a) => this.zonk(a)));
      default:
        return p;
    }
  }
}
