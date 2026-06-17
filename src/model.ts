export type Hash = string; // e.g. "#7f3a1b2c"

/** The content-addressed unit. Stored by hashOf(content). Immutable forever. */
export interface DefinitionContent {
  deps: Hash[]; // other definitions this one references, by identity (hash)
  body: string; // opaque in this wedge — we prove merge, not evaluation
}

/** A binding in a namespace: a name pointing at a content hash, plus the
 *  metadata a human or a resolver needs to adjudicate (intent + author). */
export interface Binding {
  hash: Hash;
  intent: string;
  by: string;
}

/** name -> Binding. The whole "codebase" as seen at one point in time. */
export type Namespace = Map<string, Binding>;

/** What an agent submits. `puts` add content (these always commute, because
 *  content is addressed by hash). `binds` point names at hashes — the only
 *  place a conflict can ever arise. */
export interface Transaction {
  by: string;
  puts: DefinitionContent[];
  binds: { name: string; hash: Hash; intent: string }[];
}

/** Two or more agents bound the SAME name to DIFFERENT content. Parked, never
 *  thrown: the rest of the merge stands while this waits for a decision. */
export interface Conflict {
  name: string;
  base: Hash | null; // what the name pointed at before the batch
  contenders: { by: string; hash: Hash; intent: string }[];
}

/** A bind dropped by the green-by-construction guard (e.g. dangling deps). */
export interface Rejected {
  name: string;
  by: string;
  hash: Hash;
  reason: string;
}

export interface MergeResult {
  namespace: Namespace;
  applied: string[]; // names successfully (re)bound this batch
  conflicts: Conflict[]; // parked — do NOT block the rest
  rejected: Rejected[]; // invalid binds, kept out of the green namespace
}
