import type { Hash } from "./core/term.ts";

/** A binding in a namespace: a name pointing at a content hash, plus the
 *  metadata a human or a resolver needs to adjudicate (intent + author). */
export interface Binding {
  hash: Hash;
  intent: string;
  by: string;
  /** Checks this binding must have attested before it counts as fully green. */
  requires?: string[];
}

/** name -> Binding. The whole "codebase" as seen at one point in time. */
export type Namespace = Map<string, Binding>;

/** A pending transaction: an agent's intent to (re)bind some names. The content
 *  itself already lives in the shared store (it was put there, content-addressed
 *  and harmless, when the agent compiled it). Binding is the only contested act. */
export interface PendingTx {
  by: string;
  intent: string;
  binds: { name: string; hash: Hash }[];
}

/** Two or more agents bound the SAME name to DIFFERENT content. Parked, never
 *  thrown: the rest of the merge stands while this waits for a decision. */
export interface Conflict {
  name: string;
  base: Hash | null;
  contenders: { by: string; hash: Hash; intent: string }[];
}

/** A bind dropped by the green-by-construction guard. */
export interface Rejected {
  name: string;
  by: string;
  hash: Hash;
  reason: string;
}

export interface MergeResult {
  namespace: Namespace;
  applied: string[];
  conflicts: Conflict[];
  rejected: Rejected[];
}
