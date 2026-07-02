import { observe, resolve as resolveName, view } from "./distributed/crdt.ts";
import { StrandError } from "./errors.ts";
import type { Hash } from "./core/term.ts";
import type { Conflict, Rejected } from "./model.ts";
import type { RepoState } from "./persist.ts";

/** The repo-level merge, on one algebra: the CRDT namespace is the source of
 *  truth, and the resolved `namespace` + parked `conflicts` are *derived* from
 *  its view. Local and distributed merges therefore agree by construction —
 *  a batch of pending transactions is nothing more than a set of observations.
 *
 *  Contention rule (unchanged, now order-independent): a name observed at two
 *  or more distinct hashes in the same round parks; a lone (re)bind supersedes
 *  any earlier binding via a monotone resolution, so an update is an ordinary
 *  step and never a conflict with the past. */

export interface RepoMergeResult {
  applied: string[];
  conflicts: Conflict[];
  rejected: Rejected[];
}

/** Re-derive the resolved namespace and parked conflicts from the CRDT view,
 *  carrying over the `requires` annotations (they live on the view, not in the
 *  contention algebra). */
export function deriveView(repo: RepoState): void {
  const v = view(repo.crdt);
  for (const [name, b] of v.namespace) {
    const req = repo.namespace.get(name)?.requires;
    if (req) b.requires = req;
  }
  repo.namespace = v.namespace;
  repo.conflicts = v.conflicts;
}

/** Merge the pending transactions into the CRDT and derive the new view.
 *  Binds to unresolvable content are rejected before they touch the state
 *  (the green guard); everything else becomes an observation. */
export function mergeRepo(repo: RepoState): RepoMergeResult {
  const rejected: Rejected[] = [];
  const round = new Map<string, { hashes: Set<Hash>; by: string }>();

  for (const tx of repo.pending) {
    for (const b of tx.binds) {
      if (!repo.store.isResolvable(b.hash)) {
        rejected.push({ name: b.name, by: tx.by, hash: b.hash, reason: "unresolvable content" });
        continue;
      }
      repo.crdt = observe(repo.crdt, b.name, { hash: b.hash, by: tx.by, intent: tx.intent });
      const r = round.get(b.name) ?? { hashes: new Set<Hash>(), by: tx.by };
      r.hashes.add(b.hash);
      round.set(b.name, r);
    }
  }

  const applied: string[] = [];
  for (const [name, r] of round) {
    if (r.hashes.size !== 1) continue; // ≥2 distinct hashes this round: park
    applied.push(name);
    const h = [...r.hashes][0];
    const state = repo.crdt.get(name)!;
    const distinct = new Set(state.obs.map((o) => o.hash));
    // a lone rebind of an already-observed name supersedes: settle it with a
    // resolution one logical step past whatever decision stood before.
    if (distinct.size > 1 && state.resolution?.hash !== h) {
      repo.crdt = resolveName(repo.crdt, name, h, r.by, (state.resolution?.seq ?? 0) + 1);
    }
  }

  deriveView(repo);
  repo.pending = [];
  for (const name of applied) {
    const b = repo.namespace.get(name)!;
    repo.history.push({ name, hash: b.hash, by: b.by, intent: b.intent });
  }
  return { applied, conflicts: repo.conflicts, rejected };
}

/** Settle a parked name by choosing one of its contenders — a monotone CRDT
 *  resolution, so the decision gossips to every peer and survives restarts. */
export function resolveRepo(repo: RepoState, name: string, hash: Hash, by: string): void {
  const conflict = repo.conflicts.find((c) => c.name === name);
  if (!conflict) throw new StrandError(`no parked conflict for '${name}'`);
  if (!conflict.contenders.some((c) => c.hash === hash)) {
    throw new StrandError(`hash ${hash} is not a contender for '${name}'`);
  }
  const state = repo.crdt.get(name);
  repo.crdt = resolveName(repo.crdt, name, hash, by, (state?.resolution?.seq ?? 0) + 1);
  deriveView(repo);
}
