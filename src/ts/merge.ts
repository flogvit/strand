import type { Conflict, MergeResult, Namespace, PendingTx } from "./model.ts";
import type { Hash, TsStore } from "./store.ts";

/** Reconcile concurrent transactions over TypeScript definitions. Identical to
 *  the Strand-language merge in spirit: independent names auto-merge, the only
 *  conflict is two agents binding the SAME name to DIFFERENT content, and that
 *  conflict is parked. A bind whose dependencies wouldn't resolve in the result
 *  is rejected rather than merged. */
export function mergeTs(base: Namespace, store: TsStore, txs: PendingTx[]): MergeResult {
  const universe = new Set(base.keys());
  for (const tx of txs) for (const b of tx.binds) universe.add(b.name);

  const byName = new Map<string, { by: string; hash: Hash; intent: string }[]>();
  for (const tx of txs) {
    for (const b of tx.binds) {
      const list = byName.get(b.name) ?? [];
      list.push({ by: tx.by, hash: b.hash, intent: tx.intent });
      byName.set(b.name, list);
    }
  }

  const namespace: Namespace = new Map(base);
  const applied: string[] = [];
  const conflicts: Conflict[] = [];
  const rejected: MergeResult["rejected"] = [];

  for (const [name, contenders] of byName) {
    const valid = contenders.filter((c) => {
      const def = store.get(c.hash);
      const ok = !!def && def.deps.every((d) => universe.has(d));
      if (!ok) rejected.push({ name, by: c.by, hash: c.hash, reason: "unresolved dependency" });
      return ok;
    });
    if (valid.length === 0) continue;

    const distinct = [...new Set(valid.map((c) => c.hash))];
    if (distinct.length === 1) {
      const winner = valid[0];
      namespace.set(name, { hash: winner.hash, intent: winner.intent, by: winner.by });
      applied.push(name);
    } else {
      conflicts.push({ name, base: base.get(name)?.hash ?? null, contenders: valid });
    }
  }

  return { namespace, applied, conflicts, rejected };
}

export function resolveConflict(namespace: Namespace, conflict: Conflict, chosenHash: Hash): Namespace {
  const choice = conflict.contenders.find((c) => c.hash === chosenHash);
  if (!choice) throw new Error(`hash ${chosenHash} is not a contender for '${conflict.name}'`);
  const next = new Map(namespace);
  next.set(conflict.name, { hash: choice.hash, intent: choice.intent, by: choice.by });
  return next;
}
