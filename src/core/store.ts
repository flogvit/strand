import { hashOf } from "./hash.ts";
import { depsOf, type CoreDef, type Hash } from "./term.ts";
import type { Ty } from "./types.ts";

/** A definition as stored: its content plus its checked type (cached so callers
 *  can be typechecked against it without re-deriving). The type is fully
 *  determined by the content, so this is a cache, never an independent fact. */
export interface StoredDef {
  def: CoreDef;
  ty: Ty;
}

/** Append-only, content-addressed store. put() is idempotent: identical content
 *  yields the same hash, so concurrent puts of the same thing merge for free.
 *  Nothing is ever mutated or removed — which is why a hash a peer pinned
 *  yesterday still resolves today. Serializable to/from plain JSON. */
export class Store {
  private readonly objects = new Map<Hash, StoredDef>();

  put(def: CoreDef, ty: Ty): Hash {
    const h = hashOf(def);
    if (!this.objects.has(h)) this.objects.set(h, { def, ty });
    return h;
  }

  has(h: Hash): boolean {
    return this.objects.has(h);
  }

  get(h: Hash): StoredDef | undefined {
    return this.objects.get(h);
  }

  typeOf(h: Hash): Ty | undefined {
    return this.objects.get(h)?.ty;
  }

  /** Resolvable iff present and all transitive-by-one-step deps are present.
   *  The simplest form of "green by construction". */
  isResolvable(h: Hash): boolean {
    const s = this.objects.get(h);
    if (!s) return false;
    return depsOf(s.def.body).every((d) => this.objects.has(d));
  }

  toJSON(): Record<Hash, StoredDef> {
    return Object.fromEntries(this.objects);
  }

  static fromJSON(data: Record<Hash, StoredDef>): Store {
    const s = new Store();
    for (const [h, sd] of Object.entries(data)) s.objects.set(h, sd);
    return s;
  }
}
