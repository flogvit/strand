import { Store } from "./core/store.ts";
import type { Hash } from "./core/term.ts";
import { emptyNamespace, observe, view } from "./distributed/crdt.ts";
import type { Conflict, MergeResult, Namespace, PendingTx } from "./model.ts";

/** Thin adapter over the CRDT — the one merge algebra (src/distributed/crdt.ts).
 *  A batch of concurrent transactions is a set of observations; the CRDT view
 *  decides contention, so this and the distributed join can never disagree.
 *
 *  Invariants (unchanged, now inherited from the view):
 *   - names nobody contends on are applied untouched (independent work merges).
 *   - the ONLY conflict is two agents binding the SAME name to DIFFERENT hashes.
 *   - convergent edits (same name, same hash) are NOT a conflict.
 *   - a bind to unresolvable content is rejected, not merged (green guard).
 *   - conflicts are returned, not thrown: the rest of the merge still stands. */
export function merge(base: Namespace, store: Store, txs: PendingTx[]): MergeResult {
  let round = emptyNamespace();
  const rejected: MergeResult["rejected"] = [];
  for (const tx of txs) {
    for (const b of tx.binds) {
      if (!store.isResolvable(b.hash)) {
        rejected.push({ name: b.name, by: tx.by, hash: b.hash, reason: "unresolvable content" });
        continue;
      }
      round = observe(round, b.name, { hash: b.hash, by: tx.by, intent: tx.intent });
    }
  }

  const v = view(round);
  const namespace: Namespace = new Map(base);
  const applied: string[] = [];
  for (const [name, b] of v.namespace) {
    namespace.set(name, b);
    applied.push(name);
  }
  const conflicts = v.conflicts.map((c) => ({ ...c, base: base.get(c.name)?.hash ?? null }));
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
