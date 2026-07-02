/** Worker presence as CRDT state (#43): heartbeats gossiped exactly like hints,
 *  so a dashboard can render live nodes. Never coordination — nothing reads
 *  presence to make a decision, only to render one; losing every record loses
 *  no correctness. Join is a union keyed by (workerId, seq); the view keeps the
 *  latest seq per worker. Time is logical (the merge-history round counter),
 *  so a beat expires only as the rest of the swarm advances past it. */

export interface Beat {
  workerId: string;
  provider: string;
  /** Task id currently claimed, or null between tasks. */
  currentTask: string | null;
  /** The worker's logical clock at beat time — latest seq wins in the view. */
  seq: number;
  /** Logical time at which this beat stops counting as alive. */
  expiresAt: number;
  /** Done/parked counts this run, for the node card. */
  done: number;
  parked: number;
}

/** Grow-only set of beats; union deduplicates on (workerId, seq). */
export type PresenceMap = Map<string, Beat>;

const idOf = (workerId: string, seq: number): string => `${workerId}|${seq}`;

export function emptyPresence(): PresenceMap {
  return new Map();
}

/** Record a heartbeat. Always succeeds; monotone (join with a singleton). */
export function beat(p: PresenceMap, b: Beat): PresenceMap {
  return join(p, new Map([[idOf(b.workerId, b.seq), b]]));
}

/** CRDT join: union of beats. Commutative, associative, idempotent. */
export function join(a: PresenceMap, b: PresenceMap): PresenceMap {
  const out: PresenceMap = new Map(a);
  for (const [k, v] of b) if (!out.has(k)) out.set(k, v);
  return out;
}

export interface NodeView extends Beat {
  /** Live at logical time `now` (expiresAt in the future)? Expired means the
   *  worker went quiet while the swarm moved on — gone or finished. */
  alive: boolean;
  /** Rounds since the beat, for a "last seen" display. */
  age: number;
}

/** One card per worker: its latest beat, annotated with liveness at `now`. */
export function nodes(p: PresenceMap, now: number): NodeView[] {
  const latest = new Map<string, Beat>();
  for (const b of p.values()) {
    const prev = latest.get(b.workerId);
    if (!prev || b.seq > prev.seq) latest.set(b.workerId, b);
  }
  return [...latest.values()]
    .map((b) => ({ ...b, alive: b.expiresAt > now, age: Math.max(0, now - b.seq) }))
    .sort((a, z) => a.workerId.localeCompare(z.workerId));
}

/** JSON for the wire (plain objects). */
export function toJSON(p: PresenceMap): Record<string, Beat> {
  return Object.fromEntries(p);
}

export function fromJSON(obj: Record<string, Beat>): PresenceMap {
  return new Map(Object.entries(obj));
}
