/** Optional advisory claims layered over the optimistic CRDT core. The core (merge
 *  + green-gate) is always the authority: correctness never depends on coordination,
 *  so nothing here can block a worker or become a single point of failure. These are
 *  *soft hints* — "I intend to work on name X" — gossiped as more CRDT state so agents
 *  can steer around each other on the few hot definitions where a park would waste
 *  real work. A hint is never a lock; a crashed announcer's hint simply expires (TTL),
 *  so nothing gets stuck waiting.
 *
 *  Time is logical (a round counter passed in as `now`), so there is no wall clock to
 *  disagree about across machines. */

export interface Intent {
  name: string;
  agent: string;
  /** Logical time at which this hint stops counting. */
  expiresAt: number;
}

/** A grow-only set of announcements, keyed by a unique id so union deduplicates. */
export type Hints = Map<string, Intent>;

const idOf = (agent: string, name: string, seq: number): string => `${agent}|${name}|${seq}`;

export function emptyHints(): Hints {
  return new Map();
}

/** Announce intent to work on `name`. Always succeeds — never blocks, never denies.
 *  `seq` is the announcer's logical clock; the hint expires at `now`-relative `ttl`. */
export function announce(hints: Hints, name: string, agent: string, seq: number, expiresAt: number): Hints {
  return join(hints, new Map([[idOf(agent, name, seq), { name, agent, expiresAt }]]));
}

/** CRDT join: union of announcements. Commutative, associative, idempotent. */
export function join(a: Hints, b: Hints): Hints {
  const out: Hints = new Map(a);
  for (const [k, v] of b) if (!out.has(k)) out.set(k, v);
  return out;
}

/** Agents (other than `self`) with a live hint on `name` at logical time `now`. */
export function activeClaimants(hints: Hints, name: string, now: number, self?: string): string[] {
  const agents = new Set<string>();
  for (const i of hints.values()) {
    if (i.name === name && i.expiresAt > now && i.agent !== self) agents.add(i.agent);
  }
  return [...agents];
}

/** Policy: is `name` worth consulting hints for before diving in? Only the hot,
 *  widely-depended-on definitions — everywhere else pure optimistic is faster.
 *  `fanIn` comes from the partitioner's centrality. */
export function shouldConsult(fanIn: number, hotThreshold = 3): boolean {
  return fanIn >= hotThreshold;
}

/** Advice for a worker about to take `name`: steer away only if it is hot AND
 *  someone else is actively on it. Otherwise proceed (optimistic). Never a hard stop. */
export function shouldAvoid(hints: Hints, name: string, fanIn: number, now: number, self: string): boolean {
  if (!shouldConsult(fanIn)) return false;
  return activeClaimants(hints, name, now, self).length > 0;
}

/** JSON for the wire (plain objects). */
export function toJSON(hints: Hints): Record<string, Intent> {
  return Object.fromEntries(hints);
}

export function fromJSON(obj: Record<string, Intent>): Hints {
  return new Map(Object.entries(obj));
}
