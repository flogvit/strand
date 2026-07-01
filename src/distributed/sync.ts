import { Store, type StoredItem } from "../core/store.ts";
import type { Hash } from "../core/term.ts";
import { fromJSON, join, toJSON, type CrdtNamespace, type NameState } from "./crdt.ts";

/** The sync plane. Peers move definitions between machines with no coordinator and
 *  no single point of failure: the store is a grow-only set of content-addressed
 *  objects (union converges trivially) and the namespace is a CRDT (join converges).
 *  A peer ships a snapshot; a receiver merges it. Symmetric and order-independent,
 *  so any subset of peers gossiping in any pairing all converge on the same state —
 *  losing any peer loses no correctness. Transport is out of scope here; a Snapshot
 *  is exactly the bytes that go on the wire. */

export interface Peer {
  store: Store;
  ns: CrdtNamespace;
}

/** Everything a peer would put on the wire — plain JSON. */
export interface Snapshot {
  store: Record<Hash, StoredItem>;
  ns: Record<string, NameState>;
}

/** The hashes `theirHashes` covers that `store` is missing. */
export function missing(store: Store, theirHashes: Hash[]): Hash[] {
  return theirHashes.filter((h) => !store.has(h));
}

/** Capture a peer's full state as a serializable snapshot (round-trips through JSON). */
export function snapshot(peer: Peer): Snapshot {
  return { store: peer.store.toJSON(), ns: toJSON(peer.ns) };
}

/** Merge a received snapshot into a peer: union the objects, join the namespace. */
export function apply(into: Peer, snap: Snapshot): void {
  for (const [hash, item] of Object.entries(snap.store)) into.store.putItem(hash, item);
  into.ns = join(into.ns, fromJSON(snap.ns));
}

/** Bidirectional convergent sync between two peers, over the JSON wire. Afterward
 *  both hold the union of objects and the joined namespace — identical state. */
export function sync(a: Peer, b: Peer): void {
  const sa = snapshot(a);
  const sb = snapshot(b);
  apply(a, sb);
  apply(b, sa);
}
