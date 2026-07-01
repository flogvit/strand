import type { Hash } from "../core/term.ts";
import type { Binding, Conflict, Namespace } from "../model.ts";

/** The namespace as a state-based CRDT (a join-semilattice), so any number of
 *  machines converge on the same namespace with no coordinator and no round-trips:
 *  `join` is commutative, associative and idempotent, so the order bindings arrive
 *  in — and which peer merges with which — never changes the result.
 *
 *  Per name the state grows monotonically:
 *   - `obs` is a grow-only set of observed bindings (one per distinct content hash).
 *   - a name is *resolved* iff it has exactly one observed hash, *parked* iff it has
 *     two or more — the same rule the batch merge uses, now order-independent.
 *   - a `resolution` is itself a monotone add (a park settled by choosing a hash);
 *     the highest logical `seq` wins, ties broken by hash, so resolutions converge too. */

export interface Obs {
  hash: Hash;
  by: string;
  intent: string;
}

export interface Resolution {
  hash: Hash;
  /** A logical clock: a later decision supersedes an earlier one. */
  seq: number;
  by: string;
}

export interface NameState {
  obs: Obs[];
  resolution?: Resolution;
}

export type CrdtNamespace = Map<string, NameState>;

/** Deterministic order for observations of the *same* hash, so dedup is
 *  order-independent across peers (keeps the lexicographically-smallest author). */
function obsLess(a: Obs, b: Obs): boolean {
  return a.by < b.by || (a.by === b.by && a.intent < b.intent);
}

/** Merge a set of observations into a canonical, hash-deduped, sorted list. */
function mergeObs(xs: Obs[], ys: Obs[]): Obs[] {
  const byHash = new Map<Hash, Obs>();
  for (const o of [...xs, ...ys]) {
    const cur = byHash.get(o.hash);
    if (!cur || obsLess(o, cur)) byHash.set(o.hash, o);
  }
  return [...byHash.values()].sort((a, b) => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0));
}

/** The winning resolution of two (or undefined): highest seq, ties broken by hash. */
function joinResolution(a?: Resolution, b?: Resolution): Resolution | undefined {
  if (!a) return b;
  if (!b) return a;
  if (a.seq !== b.seq) return a.seq > b.seq ? a : b;
  return a.hash >= b.hash ? a : b;
}

export function emptyNamespace(): CrdtNamespace {
  return new Map();
}

/** The lattice join of two namespace states. Pure and side-effect free. */
export function join(a: CrdtNamespace, b: CrdtNamespace): CrdtNamespace {
  const out: CrdtNamespace = new Map();
  for (const name of new Set([...a.keys(), ...b.keys()])) {
    const sa = a.get(name);
    const sb = b.get(name);
    out.set(name, {
      obs: mergeObs(sa?.obs ?? [], sb?.obs ?? []),
      resolution: joinResolution(sa?.resolution, sb?.resolution),
    });
  }
  return out;
}

/** Record an observed binding — a monotone add. */
export function observe(state: CrdtNamespace, name: string, obs: Obs): CrdtNamespace {
  return join(state, new Map([[name, { obs: [obs] }]]));
}

/** Settle a parked name by choosing one of its observed hashes — a monotone add.
 *  `seq` is a logical clock; a later resolution supersedes an earlier one. */
export function resolve(state: CrdtNamespace, name: string, hash: Hash, by: string, seq: number): CrdtNamespace {
  return join(state, new Map([[name, { obs: [], resolution: { hash, by, seq } }]]));
}

/** Collapse the CRDT state to the resolved namespace plus its parked conflicts —
 *  the view the rest of the system (green-gate, projection, review) consumes. */
export function view(state: CrdtNamespace): { namespace: Namespace; conflicts: Conflict[] } {
  const namespace: Namespace = new Map();
  const conflicts: Conflict[] = [];

  for (const [name, s] of state) {
    if (s.obs.length === 0) continue; // a resolution with no observed content yet
    const hashes = [...new Set(s.obs.map((o) => o.hash))];

    // A resolution wins only if it names one of the observed contenders.
    const chosen = s.resolution && hashes.includes(s.resolution.hash) ? s.resolution.hash : undefined;
    if (chosen) {
      const o = s.obs.find((x) => x.hash === chosen)!;
      namespace.set(name, { hash: o.hash, intent: o.intent, by: o.by });
    } else if (hashes.length === 1) {
      const o = s.obs[0];
      namespace.set(name, { hash: o.hash, intent: o.intent, by: o.by });
    } else {
      conflicts.push({
        name,
        base: null,
        contenders: s.obs.map((o) => ({ by: o.by, hash: o.hash, intent: o.intent })),
      });
    }
  }
  return { namespace, conflicts };
}

/** Lift a resolved namespace into CRDT state (each name a single observation). */
export function fromNamespace(ns: Namespace): CrdtNamespace {
  const out: CrdtNamespace = new Map();
  for (const [name, b] of ns) out.set(name, { obs: [{ hash: b.hash, by: b.by, intent: b.intent }] });
  return out;
}
