import { hashData, hashOf } from "./hash.ts";
import { depsOf, type CoreDef, type DataDecl, type Hash } from "./term.ts";
import type { Ty } from "./types.ts";

/** A stored item is either a value definition (with its checked type) or a
 *  `data` declaration. Both are content-addressed. */
export type StoredItem =
  | { kind: "def"; def: CoreDef; ty: Ty }
  | { kind: "data"; data: DataDecl };

/** Append-only, content-addressed store. Idempotent puts; nothing is ever
 *  mutated or removed. Serializable to/from plain JSON. */
export class Store {
  private objects = new Map<Hash, StoredItem>();

  put(def: CoreDef, ty: Ty): Hash {
    const h = hashOf(def);
    if (!this.objects.has(h)) this.objects.set(h, { kind: "def", def, ty });
    return h;
  }

  putData(data: DataDecl): Hash {
    const h = hashData(data);
    if (!this.objects.has(h)) this.objects.set(h, { kind: "data", data });
    return h;
  }

  get(h: Hash): StoredItem | undefined {
    return this.objects.get(h);
  }

  has(h: Hash): boolean {
    return this.objects.has(h);
  }

  defOf(h: Hash): CoreDef | undefined {
    const s = this.objects.get(h);
    return s && s.kind === "def" ? s.def : undefined;
  }

  dataOf(h: Hash): DataDecl | undefined {
    const s = this.objects.get(h);
    return s && s.kind === "data" ? s.data : undefined;
  }

  typeOf(h: Hash): Ty | undefined {
    const s = this.objects.get(h);
    return s && s.kind === "def" ? s.ty : undefined;
  }

  isResolvable(h: Hash): boolean {
    const s = this.objects.get(h);
    if (!s) return false;
    if (s.kind === "data") return true;
    return depsOf(s.def.body).every((d) => this.objects.has(d));
  }

  toJSON(): Record<Hash, StoredItem> {
    return Object.fromEntries(this.objects);
  }

  static fromJSON(data: Record<Hash, StoredItem>): Store {
    const s = new Store();
    for (const [k, v] of Object.entries(data)) s.objects.set(k, v);
    return s;
  }
}
