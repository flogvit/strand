import { Store } from "./store.ts";
import type { Conflict, Hash, MergeResult, Namespace, Rejected, Transaction } from "./model.ts";

/** The heart of Strand. Given a base namespace and a batch of concurrent
 *  transactions, produce the merged namespace plus any parked conflicts.
 *
 *  What this proves:
 *   - puts always commute (content-addressed union — order cannot matter).
 *   - names nobody contends on are applied untouched (independent work merges).
 *   - the ONLY conflict is two agents binding the SAME name to DIFFERENT hashes.
 *   - convergent edits (same name, same hash) are NOT a conflict.
 *   - a bind to unresolvable content is rejected, not merged (green guard).
 *   - conflicts are returned, not thrown: the rest of the merge still stands. */
export function merge(base: Namespace, store: Store, txs: Transaction[]): MergeResult {
  // 1. Union all content. Content-addressed => order-independent, conflict-free.
  for (const tx of txs) for (const c of tx.puts) store.put(c);

  // 2. Gather every bind, grouped by the name it targets.
  const byName = new Map<string, { by: string; hash: Hash; intent: string }[]>();
  for (const tx of txs) {
    for (const b of tx.binds) {
      const list = byName.get(b.name) ?? [];
      list.push({ by: tx.by, hash: b.hash, intent: b.intent });
      byName.set(b.name, list);
    }
  }

  const namespace: Namespace = new Map(base);
  const applied: string[] = [];
  const conflicts: Conflict[] = [];
  const rejected: Rejected[] = [];

  for (const [name, contenders] of byName) {
    // Green-by-construction guard: drop binds whose content can't resolve.
    const valid = contenders.filter((c) => {
      const ok = store.isResolvable(c.hash);
      if (!ok) rejected.push({ name, by: c.by, hash: c.hash, reason: "unresolvable deps" });
      return ok;
    });
    if (valid.length === 0) continue;

    // Distinct target hashes decide convergence vs. genuine contention.
    const distinct = [...new Set(valid.map((c) => c.hash))];
    if (distinct.length === 1) {
      // Everyone converged on identical content — apply, no conflict.
      const winner = valid[0];
      namespace.set(name, { hash: winner.hash, intent: winner.intent, by: winner.by });
      applied.push(name);
    } else {
      // Real contention on one name: park it. The name keeps its base value so
      // every other name in the batch still advances.
      conflicts.push({ name, base: base.get(name)?.hash ?? null, contenders: valid });
    }
  }

  return { namespace, applied, conflicts, rejected };
}

/** Resolve a parked conflict after the fact by choosing one contender's hash.
 *  Conflicts are first-class, deferrable objects: you set one aside, keep
 *  working, and settle it whenever — without rewinding anything. */
export function resolveConflict(
  namespace: Namespace,
  conflict: Conflict,
  chosenHash: Hash,
): Namespace {
  const choice = conflict.contenders.find((c) => c.hash === chosenHash);
  if (!choice) throw new Error(`hash ${chosenHash} is not a contender for ${conflict.name}`);
  const next = new Map(namespace);
  next.set(conflict.name, { hash: choice.hash, intent: choice.intent, by: choice.by });
  return next;
}
