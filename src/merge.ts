import { Store } from "./core/store.ts";
import type { Hash } from "./core/term.ts";
import type { Conflict, MergeResult, Namespace, PendingTx } from "./model.ts";

/** The heart of Strand. Reconcile a batch of concurrent transactions against a
 *  base namespace. Content already lives in the (append-only, content-addressed)
 *  store, so the only question is which name points where.
 *
 *  Invariants:
 *   - names nobody contends on are applied untouched (independent work merges).
 *   - the ONLY conflict is two agents binding the SAME name to DIFFERENT hashes.
 *   - convergent edits (same name, same hash) are NOT a conflict.
 *   - a bind to unresolvable content is rejected, not merged (green guard).
 *   - conflicts are returned, not thrown: the rest of the merge still stands. */
export function merge(base: Namespace, store: Store, txs: PendingTx[]): MergeResult {
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
      const ok = store.isResolvable(c.hash);
      if (!ok) rejected.push({ name, by: c.by, hash: c.hash, reason: "unresolvable content" });
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

/** Settle a parked conflict by choosing one contender's hash — at any later
 *  time, without rewinding anything. */
export function resolveConflict(namespace: Namespace, conflict: Conflict, chosenHash: Hash): Namespace {
  const choice = conflict.contenders.find((c) => c.hash === chosenHash);
  if (!choice) throw new Error(`hash ${chosenHash} is not a contender for '${conflict.name}'`);
  const next = new Map(namespace);
  next.set(conflict.name, { hash: choice.hash, intent: choice.intent, by: choice.by });
  return next;
}
