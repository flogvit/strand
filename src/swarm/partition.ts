/** Graph-partition the dependency graph to hand each agent a tightly-coupled,
 *  low-contention slice. The old `strand partition` cut only at connected-component
 *  boundaries, so a normal (single-component) codebase collapsed into one bucket.
 *  This cuts *inside* a component along its weakest seams, minimizing cross-bucket
 *  edges (= future contention) while keeping the buckets balanced.
 *
 *  The engine is Kernighan–Lin bisection (1970): from a balanced 2-way split, keep
 *  swapping the pair whose exchange most reduces the edge cut, take the best prefix
 *  of a pass, and repeat until no pass improves. Recursive bisection generalizes it
 *  to N parts. KL is a genuine local-search min-cut, robust to bridges/barbells. */

export interface GraphNode {
  id: string;
  label: string;
  /** ids of the definitions this one references (directed: caller -> callee). */
  deps: string[];
}

export interface PartitionResult {
  /** node ids per agent bucket. */
  buckets: string[][];
  /** number of edges whose endpoints landed in different buckets. */
  cut: number;
  /** fan-in per node (how many others depend on it), most-depended-on first —
   *  the hot nodes the advisory-hint layer should watch. */
  centrality: { id: string; label: string; fanIn: number }[];
}

/** Kernighan–Lin: split `ids` into two balanced parts minimizing the edge cut. */
function bisect(ids: string[], adj: Map<string, Set<string>>): [string[], string[]] {
  const half = Math.ceil(ids.length / 2);
  const part = new Map<string, 0 | 1>(ids.map((id, i) => [id, i < half ? 0 : 1]));
  const w = (a: string, b: string): number => (adj.get(a)!.has(b) ? 1 : 0);

  for (let improved = true; improved; ) {
    improved = false;
    const start = new Map(part);
    const locked = new Set<string>();
    const moves: { a: string; b: string }[] = [];
    let cumulative = 0;
    let best = { k: 0, sum: 0 };

    const size = Math.min([...part.values()].filter((p) => p === 0).length, [...part.values()].filter((p) => p === 1).length);
    for (let step = 0; step < size; step++) {
      const d = (v: string): number => {
        let ext = 0, int = 0;
        for (const nb of adj.get(v)!) part.get(nb) === part.get(v) ? int++ : ext++;
        return ext - int;
      };
      let pick: { a: string; b: string; gain: number } | null = null;
      for (const a of ids) {
        if (locked.has(a) || part.get(a) !== 0) continue;
        for (const b of ids) {
          if (locked.has(b) || part.get(b) !== 1) continue;
          const gain = d(a) + d(b) - 2 * w(a, b);
          if (!pick || gain > pick.gain) pick = { a, b, gain };
        }
      }
      if (!pick) break;
      part.set(pick.a, 1);
      part.set(pick.b, 0);
      locked.add(pick.a).add(pick.b);
      moves.push({ a: pick.a, b: pick.b });
      cumulative += pick.gain;
      if (cumulative > best.sum) best = { k: moves.length, sum: cumulative };
    }

    // keep only the best prefix of swaps (roll back the rest by replaying from start)
    part.clear();
    for (const [k, v] of start) part.set(k, v);
    for (let i = 0; i < best.k; i++) {
      part.set(moves[i].a, 1);
      part.set(moves[i].b, 0);
    }
    if (best.sum > 0) improved = true;
  }

  const a: string[] = [], b: string[] = [];
  for (const id of ids) (part.get(id) === 0 ? a : b).push(id);
  return [a, b];
}

/** Recursive bisection into `n` balanced parts. */
function splitInto(ids: string[], n: number, adj: Map<string, Set<string>>): string[][] {
  if (n <= 1 || ids.length <= 1) return [ids];
  const [a, b] = bisect(ids, adj);
  return [...splitInto(a, Math.ceil(n / 2), adj), ...splitInto(b, Math.floor(n / 2), adj)];
}

export function partition(nodes: GraphNode[], n: number): PartitionResult {
  const parts = Math.max(1, n);
  const ids = nodes.map((x) => x.id);
  const present = new Set(ids);

  // undirected adjacency (locality is symmetric) over edges that stay in the graph
  const adj = new Map<string, Set<string>>(ids.map((id) => [id, new Set<string>()]));
  const fanIn = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const node of nodes) {
    for (const d of node.deps) {
      if (!present.has(d) || d === node.id) continue;
      adj.get(node.id)!.add(d);
      adj.get(d)!.add(node.id);
      fanIn.set(d, fanIn.get(d)! + 1);
    }
  }

  const buckets = splitInto(ids, parts, adj).filter((b) => b.length > 0);
  while (buckets.length < parts) buckets.push([]);

  const bucketOf = new Map<string, number>();
  buckets.forEach((bk, i) => bk.forEach((id) => bucketOf.set(id, i)));
  let cut = 0;
  for (const [a, nbs] of adj) for (const b of nbs) if (a < b && bucketOf.get(a) !== bucketOf.get(b)) cut++;

  const labelOf = new Map(nodes.map((x) => [x.id, x.label]));
  const centrality = ids
    .map((id) => ({ id, label: labelOf.get(id)!, fanIn: fanIn.get(id)! }))
    .sort((a, b) => b.fanIn - a.fanIn);

  return { buckets, cut, centrality };
}
