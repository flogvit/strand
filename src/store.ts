import { hashOf } from "./hash.ts";
import type { DefinitionContent, Hash } from "./model.ts";

/** Append-only, content-addressed store. put() is idempotent: identical content
 *  yields the same hash, so concurrent puts of the same thing merge for free.
 *  Nothing is ever mutated or removed — which is exactly why a hash a peer
 *  pinned yesterday still resolves today. */
export class Store {
  private readonly objects = new Map<Hash, DefinitionContent>();

  put(content: DefinitionContent): Hash {
    const h = hashOf(content);
    if (!this.objects.has(h)) this.objects.set(h, content);
    return h;
  }

  has(h: Hash): boolean {
    return this.objects.has(h);
  }

  get(h: Hash): DefinitionContent | undefined {
    return this.objects.get(h);
  }

  /** A hash is resolvable iff it exists and all its direct deps exist. This is
   *  the simplest form of "green by construction": you cannot bind a name to
   *  content that references something the store doesn't contain. */
  isResolvable(h: Hash): boolean {
    const c = this.objects.get(h);
    if (!c) return false;
    return c.deps.every((d) => this.objects.has(d));
  }
}
