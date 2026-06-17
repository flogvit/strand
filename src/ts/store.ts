import { hashText } from "./hash.ts";
import type { TsDef } from "./extract.ts";

export type Hash = string;

/** Append-only, content-addressed store of TypeScript definitions. */
export class TsStore {
  private objs = new Map<Hash, TsDef>();

  put(def: TsDef): Hash {
    const h = hashText(def.text);
    if (!this.objs.has(h)) this.objs.set(h, def);
    return h;
  }

  get(h: Hash): TsDef | undefined {
    return this.objs.get(h);
  }

  has(h: Hash): boolean {
    return this.objs.has(h);
  }

  toJSON(): Record<Hash, TsDef> {
    return Object.fromEntries(this.objs);
  }

  static fromJSON(data: Record<Hash, TsDef>): TsStore {
    const s = new TsStore();
    for (const [k, v] of Object.entries(data)) s.objs.set(k, v);
    return s;
  }
}
