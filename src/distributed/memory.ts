/** Swarm decision memory — the layer that lets agents stay autonomous by
 *  *remembering* choices instead of re-asking or re-deriving them. The store +
 *  namespace already remember code and its intent; this remembers the decisions
 *  that govern code but are not themselves definitions: conventions spanning many
 *  defs, rejected alternatives with rationale, spec decisions, and — most important
 *  — assumptions taken under ambiguity ("task said 'a solver', assumed backtracking").
 *  Writing an assumption note instead of stopping to ask is what keeps the swarm
 *  moving; a human reviews it later on the narrative plane.
 *
 *  It is more CRDT state: content-addressed (two agents writing the same decision
 *  converge on one id), append-only, and supersedable (a revision keeps provenance).
 *  Synced and joined exactly like the namespace. */

export type NoteType = "convention" | "assumption" | "rejected-alternative" | "spec";

export interface Note {
  id: string;
  type: NoteType;
  subject: string;
  body: string;
  by: string;
  /** def names / task ids this note governs — what an agent reads before touching them. */
  targets: string[];
  /** id of an earlier note this one revises (kept for provenance, hidden from the view). */
  supersedes?: string;
}

export type Memory = Map<string, Note>;

/** FNV-1a hex of the note's content (author excluded, so the same decision by
 *  different agents converges on one id). */
function contentId(n: Omit<Note, "id" | "by">): string {
  const canon = JSON.stringify([n.type, n.subject, n.body, [...n.targets].sort(), n.supersedes ?? ""]);
  let h = 0x811c9dc5;
  for (let i = 0; i < canon.length; i++) {
    h ^= canon.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function emptyMemory(): Memory {
  return new Map();
}

/** Record a decision. Content-addressed: identical content converges to one entry
 *  (keeping the lexicographically-smallest author, so dedup is order-independent). */
export function record(mem: Memory, note: Omit<Note, "id">): Memory {
  const id = contentId(note);
  return join(mem, new Map([[id, { ...note, id }]]));
}

/** Record a revision of an existing note (kept in the set; hidden from the view). */
export function supersede(mem: Memory, oldId: string, note: Omit<Note, "id" | "supersedes">): Memory {
  return record(mem, { ...note, supersedes: oldId });
}

/** CRDT join: union of notes, deterministic on conflict (smallest author). */
export function join(a: Memory, b: Memory): Memory {
  const out: Memory = new Map(a);
  for (const [id, n] of b) {
    const cur = out.get(id);
    if (!cur || n.by < cur.by) out.set(id, n);
  }
  return out;
}

/** The live decisions — those no present note supersedes. */
export function active(mem: Memory): Note[] {
  const superseded = new Set<string>();
  for (const n of mem.values()) if (n.supersedes) superseded.add(n.supersedes);
  return [...mem.values()].filter((n) => !superseded.has(n.id));
}

/** The live decisions governing `target` — what an agent reads before working on it. */
export function forTarget(mem: Memory, target: string): Note[] {
  return active(mem).filter((n) => n.targets.includes(target));
}

export function toJSON(mem: Memory): Record<string, Note> {
  return Object.fromEntries(mem);
}

export function fromJSON(obj: Record<string, Note>): Memory {
  return new Map(Object.entries(obj));
}
