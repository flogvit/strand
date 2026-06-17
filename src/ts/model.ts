import type { Hash } from "./store.ts";
import type { TsStore } from "./store.ts";

export interface Binding {
  hash: Hash;
  intent: string;
  by: string;
}

export type Namespace = Map<string, Binding>;

export interface PendingTx {
  by: string;
  intent: string;
  binds: { name: string; hash: Hash }[];
}

export interface Conflict {
  name: string;
  base: Hash | null;
  contenders: { by: string; hash: Hash; intent: string }[];
}

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

export interface RepoState {
  store: TsStore;
  namespace: Namespace;
  pending: PendingTx[];
  conflicts: Conflict[];
}
