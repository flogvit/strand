import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Store, type StoredItem } from "./core/store.ts";
import type { Hash } from "./core/term.ts";
import type { Binding, Conflict, Namespace, PendingTx } from "./model.ts";
import * as crdt from "./distributed/crdt.ts";
import * as hints from "./distributed/hints.ts";
import * as memory from "./distributed/memory.ts";
import type { CrdtNamespace, NameState } from "./distributed/crdt.ts";
import type { Hints, Intent } from "./distributed/hints.ts";
import type { Memory, Note } from "./distributed/memory.ts";

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
  /** The distributed plane. The CRDT namespace is the source of truth the peers
   *  join on; `namespace` above is its resolved view, kept for readability. */
  crdt: CrdtNamespace;
  /** Advisory soft-claim hints — gossiped CRDT state, never a lock. */
  hints: Hints;
  /** Swarm decision memory: conventions, assumptions, rejected alternatives. */
  memory: Memory;
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
    crdt: join(d, "crdt.json"),
    hints: join(d, "hints.json"),
    memory: join(d, "memory.json"),
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
  const state: RepoState = {
    store: new Store(),
    namespace: new Map(),
    pending: [],
    conflicts: [],
    attestations: {},
    history: [],
    crdt: crdt.emptyNamespace(),
    hints: hints.emptyHints(),
    memory: memory.emptyMemory(),
  };
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
  // A repo written before the distributed plane existed has no crdt.json: lift
  // its resolved namespace (one observation per binding) and its parked
  // conflicts (one observation per contender) into CRDT state so it can join
  // the gossip like any other peer.
  let crdtState: CrdtNamespace;
  if (existsSync(p.crdt)) {
    crdtState = crdt.fromJSON(readJSON<Record<string, NameState>>(p.crdt, {}));
  } else {
    crdtState = crdt.fromNamespace(namespace);
    for (const c of conflicts) {
      for (const k of c.contenders) {
        crdtState = crdt.observe(crdtState, c.name, { hash: k.hash, by: k.by, intent: k.intent });
      }
    }
  }
  const hintState = hints.fromJSON(readJSON<Record<string, Intent>>(p.hints, {}));
  const memoryState = memory.fromJSON(readJSON<Record<string, Note>>(p.memory, {}));
  return { store, namespace, pending, conflicts, attestations, history, crdt: crdtState, hints: hintState, memory: memoryState };
}

export function saveRepo(root: string, state: RepoState): void {
  const p = paths(root);
  writeJSON(p.store, state.store.toJSON());
  writeJSON(p.namespace, Object.fromEntries(state.namespace));
  writeJSON(p.pending, state.pending);
  writeJSON(p.conflicts, state.conflicts);
  writeJSON(p.attestations, state.attestations);
  writeJSON(p.history, state.history);
  writeJSON(p.crdt, crdt.toJSON(state.crdt));
  writeJSON(p.hints, hints.toJSON(state.hints));
  writeJSON(p.memory, memory.toJSON(state.memory));
}
