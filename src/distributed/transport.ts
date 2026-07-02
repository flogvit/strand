import { timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { StoredItem } from "../core/store.ts";
import type { Hash } from "../core/term.ts";
import { loadRepo, saveRepo } from "../persist.ts";
import { deriveView } from "../repo.ts";
import { fromJSON as crdtFromJSON, join as joinCrdt, toJSON as crdtToJSON } from "./crdt.ts";
import * as hints from "./hints.ts";
import * as memory from "./memory.ts";
import { buildIndex, indexFromJSON, indexToJSON, reconcile, type NodeJSON } from "./merkle.ts";

/** The transport under the sync plane: plain HTTP pull between known peers.
 *  A peer serves three things — its Merkle index (so a puller can find the diff
 *  cheaply), objects by hash (only the diff crosses the wire), and its CRDT
 *  state (namespace, hints, decision memory; small and join-safe to ship whole).
 *  Pull-only and symmetric: every peer runs the same loop against its peer list,
 *  and any pairing of pulls converges because apply is a join. A dead peer is
 *  skipped, never waited on — losing a machine loses no correctness. */

interface WireState {
  ns: ReturnType<typeof crdtToJSON>;
  hints: Record<string, hints.Intent>;
  memory: Record<string, memory.Note>;
}

function json(res: import("node:http").ServerResponse, value: unknown): void {
  const body = JSON.stringify(value);
  res.writeHead(200, { "content-type": "application/json" });
  res.end(body);
}

function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

export interface ServeOptions {
  /** Shared-secret peer auth (#49): when set, every request must carry
   *  `Authorization: Bearer <token>` or it is rejected with 401. Defaults to
   *  $STRAND_SYNC_TOKEN. Without a token the transport is open — localhost
   *  and trusted LANs only (see SECURITY.md). */
  token?: string;
  /** Interface to bind. Defaults to 127.0.0.1; bind 0.0.0.0 to serve a real
   *  network — then a token is strongly recommended. */
  host?: string;
}

/** Constant-time token check — a comparison that leaks length or prefix
 *  timing would let the network brute-force the secret. */
function tokenOk(header: string | undefined, token: string): boolean {
  const presented = header?.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(presented);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Serve a repo's state to pulling peers. State is read from disk per request,
 *  so the server always ships what the worker loop most recently saved. */
export function servePeer(root: string, port: number, opts: ServeOptions = {}): Promise<Server> {
  const token = opts.token ?? process.env.STRAND_SYNC_TOKEN;
  const server = createServer(async (req, res) => {
    try {
      if (token && !tokenOk(req.headers.authorization, token)) {
        // Reject loudly: an unauthenticated pull attempt is a configuration
        // error or an intruder — either deserves a clear signal, not a 404.
        res.writeHead(401, { "content-type": "text/plain" });
        res.end("unauthorized: this peer requires Authorization: Bearer <token> (see STRAND_SYNC_TOKEN)");
        return;
      }
      if (req.method === "GET" && req.url === "/index") {
        const repo = loadRepo(root);
        json(res, indexToJSON(buildIndex(repo.store.hashes())));
      } else if (req.method === "POST" && req.url === "/objects") {
        const { hashes } = JSON.parse(await readBody(req)) as { hashes: Hash[] };
        const repo = loadRepo(root);
        const objects: Record<Hash, StoredItem> = {};
        for (const h of hashes) {
          const item = repo.store.get(h);
          if (item) objects[h] = item;
        }
        json(res, { objects });
      } else if (req.method === "GET" && req.url === "/state") {
        const repo = loadRepo(root);
        json(res, {
          ns: crdtToJSON(repo.crdt),
          hints: hints.toJSON(repo.hints),
          memory: memory.toJSON(repo.memory),
        } satisfies WireState);
      } else {
        res.writeHead(404);
        res.end();
      }
    } catch (e) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(String((e as Error).message));
    }
  });
  return new Promise((resolve) => server.listen(port, opts.host ?? "127.0.0.1", () => resolve(server)));
}

function authHeaders(token: string | undefined): Record<string, string> {
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function getJSON<T>(url: string, token?: string): Promise<T> {
  const res = await fetch(url, { headers: authHeaders(token) });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return (await res.json()) as T;
}

export interface GossipOptions {
  /** Shared-secret sent as `Authorization: Bearer <token>` (#49). Defaults to
   *  $STRAND_SYNC_TOKEN, so both halves of the transport read one knob. */
  token?: string;
}

/** One anti-entropy round against each peer: pull the peer's index, fetch only
 *  the objects the Merkle diff says are missing, then join its CRDT state.
 *  Unreachable peers are skipped — gossip tolerates any subset being down. */
export async function gossipOnce(root: string, peers: string[], opts: GossipOptions = {}): Promise<{ pulledObjects: number; peersReached: number }> {
  const token = opts.token ?? process.env.STRAND_SYNC_TOKEN;
  let pulledObjects = 0;
  let peersReached = 0;

  for (const peer of peers) {
    let theirIndex: NodeJSON;
    let state: WireState;
    try {
      theirIndex = await getJSON<NodeJSON>(`${peer}/index`, token);
      state = await getJSON<WireState>(`${peer}/state`, token);
    } catch {
      continue; // peer down — nothing to do, try again next round
    }

    const repo = loadRepo(root);
    const diff = reconcile(buildIndex(repo.store.hashes()), indexFromJSON(theirIndex));
    if (diff.missingFromA.length > 0) {
      const res = await fetch(`${peer}/objects`, {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders(token) },
        body: JSON.stringify({ hashes: diff.missingFromA }),
      });
      if (!res.ok) continue;
      const { objects } = (await res.json()) as { objects: Record<Hash, StoredItem> };
      for (const [h, item] of Object.entries(objects)) repo.store.putItem(h, item);
      pulledObjects += Object.keys(objects).length;
    }

    repo.crdt = joinCrdt(repo.crdt, crdtFromJSON(state.ns));
    repo.hints = hints.join(repo.hints, hints.fromJSON(state.hints));
    repo.memory = memory.join(repo.memory, memory.fromJSON(state.memory));
    deriveView(repo);
    saveRepo(root, repo);
    peersReached++;
  }

  return { pulledObjects, peersReached };
}
