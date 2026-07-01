import type { Hash } from "../core/term.ts";

/** Anti-entropy over a Merkle trie of the store's hashes. When two peers sync they
 *  must discover *which* objects each lacks — cheaply. Comparing full hash lists is
 *  O(total) every round; at scale that is the bottleneck, not the transfer. Instead
 *  each peer summarizes its hash set as a trie with a digest per node: equal digests
 *  mean an identical subtree, so reconciliation skips it and descends only where the
 *  sets differ. Cost is O(size of the diff), not O(size of the store). Content-
 *  addressing makes every digest stable, so there is no invalidation bookkeeping. */

const DEPTH = 4; // trie depth over the balanced key; 16^4 leaf buckets

interface Node {
  digest: string;
  children?: Map<string, Node>;
  members?: Hash[];
}

export interface MerkleIndex {
  root: Node;
}

/** FNV-1a → 8 hex chars. A balanced re-hash so the trie is uniform regardless of
 *  how the underlying object hashes happen to be shaped. */
function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

const keyOf = (h: Hash): string => fnv(h).slice(0, DEPTH);

function digestOf(node: Node): string {
  if (node.members) return fnv([...node.members].sort().join("|"));
  const parts = [...node.children!.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  return fnv(parts.map(([k, c]) => k + c.digest).join("|"));
}

export function buildIndex(hashes: Hash[]): MerkleIndex {
  const root: Node = { digest: "", children: new Map() };
  for (const h of hashes) {
    const key = keyOf(h);
    let node = root;
    for (let d = 0; d < DEPTH; d++) {
      const c = key[d];
      if (!node.children!.has(c)) {
        node.children!.set(c, d === DEPTH - 1 ? { digest: "", members: [] } : { digest: "", children: new Map() });
      }
      node = node.children!.get(c)!;
    }
    node.members!.push(h);
  }
  // compute digests bottom-up
  const finalize = (node: Node): void => {
    if (node.children) for (const c of node.children.values()) finalize(c);
    node.digest = digestOf(node);
  };
  finalize(root);
  return { root };
}

function membersUnder(node: Node | undefined, out: Set<Hash>): void {
  if (!node) return;
  if (node.members) for (const m of node.members) out.add(m);
  if (node.children) for (const c of node.children.values()) membersUnder(c, out);
}

export interface Reconciliation {
  /** Hashes `b` holds that `a` is missing. */
  missingFromA: Hash[];
  /** Hashes `a` holds that `b` is missing. */
  missingFromB: Hash[];
  /** Nodes descended into — a witness that matching subtrees were pruned. */
  nodesVisited: number;
}

/** Reconcile two indices, descending only where digests differ. */
export function reconcile(a: MerkleIndex, b: MerkleIndex): Reconciliation {
  const missA = new Set<Hash>();
  const missB = new Set<Hash>();
  let nodesVisited = 0;

  const rec = (na: Node | undefined, nb: Node | undefined): void => {
    nodesVisited++;
    if (na?.digest === nb?.digest) return; // identical subtree — prune
    if (!na || !nb || na.members || nb.members) {
      // a leaf on either side (or a subtree only one has): diff the member sets
      const ma = new Set<Hash>(), mb = new Set<Hash>();
      membersUnder(na, ma);
      membersUnder(nb, mb);
      for (const h of mb) if (!ma.has(h)) missA.add(h);
      for (const h of ma) if (!mb.has(h)) missB.add(h);
      return;
    }
    for (const k of new Set([...na.children!.keys(), ...nb.children!.keys()])) {
      rec(na.children!.get(k), nb.children!.get(k));
    }
  };
  rec(a.root, b.root);

  return { missingFromA: [...missA], missingFromB: [...missB], nodesVisited };
}
