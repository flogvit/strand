import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { emitModule } from "../backend/emit_ts.ts";
import { tyToString } from "../core/types.ts";
import { activeClaimants } from "../distributed/hints.ts";
import { active } from "../distributed/memory.ts";
import { buildIndex, indexToJSON, type NodeJSON } from "../distributed/merkle.ts";
import { nodes, type NodeView } from "../distributed/presence.ts";
import { gossipOnce } from "../distributed/transport.ts";
import { loadRepo } from "../persist.ts";
import { namesOf, renderDef } from "../project.ts";
import type { Note } from "../distributed/memory.ts";
import type { Queue, Task } from "./queue.ts";

/** The swarm dashboard (#42): a read-only observer next to the loop. It joins
 *  the sync plane exactly like any peer — gossip in, never a write out: it does
 *  not submit, merge, claim or announce, so losing it loses nothing. One JSON
 *  snapshot endpoint feeds a static, framework-free page with the four views:
 *  nodes (#43), the task DAG (#44), decision memory (#45), the namespace (#46). */

export interface DashboardOptions {
  root: string;
  port: number;
  queue: Queue;
  /** Peers to gossip with — the observer sees what the swarm sees. */
  peers?: string[];
  /** Sync-plane auth token (#49). */
  token?: string;
  /** Gossip cadence; the page polls at the same order of magnitude. */
  gossipMs?: number;
  host?: string;
}

export interface BindingView {
  name: string;
  hash: string;
  by: string;
  intent: string;
  /** Type signature for defs, "data" for declarations. */
  type: string;
  source: string;
  requires: string[];
  attested: string[];
  /** Workers with a live intent on this name — the hints overlay (#46). */
  activeIntents: string[];
}

export interface Snapshot {
  now: number;
  tasks: Task[];
  bindings: BindingView[];
  conflicts: { name: string; contenders: { by: string; hash: string; intent: string; source: string }[] }[];
  memory: { notes: Note[]; activeIds: string[] };
  presence: NodeView[];
  emitTs: string;
  merkle: { self: string; peers: { url: string; root: string | null }[] };
}

async function peerRoot(url: string, token?: string): Promise<string | null> {
  try {
    const res = await fetch(`${url}/index`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return null;
    const idx = (await res.json()) as NodeJSON;
    return idx.digest;
  } catch {
    return null;
  }
}

export async function snapshot(root: string, queue: Queue, peers: string[] = [], token?: string): Promise<Snapshot> {
  const repo = loadRepo(root);
  const now = repo.history.length;
  const nameOf = namesOf(repo.namespace);

  const bindings: BindingView[] = [...repo.namespace]
    .sort((a, z) => a[0].localeCompare(z[0]))
    .map(([name, b]) => {
      const ty = repo.store.typeOf(b.hash);
      return {
        name,
        hash: b.hash,
        by: b.by,
        intent: b.intent,
        type: ty ? tyToString(ty) : repo.store.dataOf(b.hash) ? "data" : "",
        source: renderDef(name, b.hash, repo.store, nameOf),
        requires: b.requires ?? [],
        attested: repo.attestations[b.hash] ?? [],
        activeIntents: activeClaimants(repo.hints, name, now),
      };
    });

  const conflicts = repo.conflicts.map((c) => ({
    name: c.name,
    contenders: c.contenders.map((k) => ({
      ...k,
      source: (() => {
        try {
          return renderDef(c.name, k.hash, repo.store, nameOf);
        } catch {
          return "(source unavailable)";
        }
      })(),
    })),
  }));

  return {
    now,
    tasks: queue.list(),
    bindings,
    conflicts,
    memory: { notes: [...repo.memory.values()], activeIds: active(repo.memory).map((n) => n.id) },
    presence: nodes(repo.presence, now),
    emitTs: emitModule(repo.namespace, repo.store),
    merkle: {
      self: indexToJSON(buildIndex(repo.store.hashes())).digest,
      peers: await Promise.all(peers.map(async (url) => ({ url, root: await peerRoot(url, token) }))),
    },
  };
}

const HTML = () => readFileSync(join(dirname(fileURLToPath(import.meta.url)), "dashboard.html"), "utf8");

export function startDashboard(opts: DashboardOptions): Promise<{ server: Server; stop: () => void }> {
  const { root, port, queue, peers = [], token, gossipMs = 3000, host } = opts;

  // The observer's own gossip loop — its local repo root converges on what the
  // swarm sees. Errors are swallowed: a dead peer is a skipped round, nothing more.
  let timer: ReturnType<typeof setInterval> | undefined;
  if (peers.length > 0) {
    const round = (): void => {
      gossipOnce(root, peers, { token }).catch(() => {});
    };
    round();
    timer = setInterval(round, gossipMs);
    timer.unref?.();
  }

  const server = createServer(async (req, res) => {
    try {
      if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(HTML());
      } else if (req.method === "GET" && req.url === "/api/snapshot") {
        const snap = await snapshot(root, queue, peers, token);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(snap));
      } else {
        res.writeHead(404);
        res.end();
      }
    } catch (e) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(String((e as Error).message));
    }
  });

  const stop = (): void => {
    if (timer) clearInterval(timer);
    server.close();
  };

  return new Promise((resolve) => server.listen(port, host ?? "127.0.0.1", () => resolve({ server, stop })));
}
