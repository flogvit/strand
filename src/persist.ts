import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Store, type StoredItem } from "./core/store.ts";
import type { Hash } from "./core/term.ts";
import type { Binding, Conflict, Namespace, PendingTx } from "./model.ts";

const DIR = ".strand";

/** One applied binding from a merge — a step on the work plane. */
export interface HistoryEntry {
  name: string;
  hash: Hash;
  by: string;
  intent: string;
}

export interface RepoState {
  store: Store;
  namespace: Namespace;
  pending: PendingTx[];
  conflicts: Conflict[];
  /** Checks attested for a content hash. Keyed on hash, so attestations never
   *  go stale: change a definition and its hash (and required attestations) change. */
  attestations: Record<Hash, string[]>;
  /** Every applied binding, in order — the messy work plane that `distill` reads. */
  history: HistoryEntry[];
}

function paths(root: string) {
  const d = join(root, DIR);
  return {
    dir: d,
    store: join(d, "store.json"),
    namespace: join(d, "namespace.json"),
    pending: join(d, "pending.json"),
    conflicts: join(d, "conflicts.json"),
    attestations: join(d, "attestations.json"),
    history: join(d, "history.json"),
  };
}

function readJSON<T>(file: string, fallback: T): T {
  if (!existsSync(file)) return fallback;
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

function writeJSON(file: string, value: unknown): void {
  writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

export function repoExists(root: string): boolean {
  return existsSync(join(root, DIR));
}

export function initRepo(root: string): RepoState {
  mkdirSync(paths(root).dir, { recursive: true });
  const state: RepoState = { store: new Store(), namespace: new Map(), pending: [], conflicts: [], attestations: {}, history: [] };
  saveRepo(root, state);
  return state;
}

export function loadRepo(root: string): RepoState {
  const p = paths(root);
  const store = Store.fromJSON(readJSON<Record<Hash, StoredItem>>(p.store, {}));
  const nsObj = readJSON<Record<string, Binding>>(p.namespace, {});
  const namespace: Namespace = new Map(Object.entries(nsObj));
  const pending = readJSON<PendingTx[]>(p.pending, []);
  const conflicts = readJSON<Conflict[]>(p.conflicts, []);
  const attestations = readJSON<Record<Hash, string[]>>(p.attestations, {});
  const history = readJSON<HistoryEntry[]>(p.history, []);
  return { store, namespace, pending, conflicts, attestations, history };
}

export function saveRepo(root: string, state: RepoState): void {
  const p = paths(root);
  writeJSON(p.store, state.store.toJSON());
  writeJSON(p.namespace, Object.fromEntries(state.namespace));
  writeJSON(p.pending, state.pending);
  writeJSON(p.conflicts, state.conflicts);
  writeJSON(p.attestations, state.attestations);
  writeJSON(p.history, state.history);
}
