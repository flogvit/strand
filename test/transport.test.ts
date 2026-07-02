import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initRepo, loadRepo, saveRepo, type RepoState } from "../src/persist.ts";
import { mergeRepo } from "../src/repo.ts";
import { compileProgram } from "../src/pipeline.ts";
import { buildIndex, indexFromJSON, indexToJSON, reconcile } from "../src/distributed/merkle.ts";
import { gossipOnce, servePeer } from "../src/distributed/transport.ts";
import { record } from "../src/distributed/memory.ts";
import { announce } from "../src/distributed/hints.ts";
import type { AddressInfo } from "node:net";
import type { Hash } from "../src/core/term.ts";

// The transport makes the sync plane real: a peer serves its state over HTTP,
// another pulls, reconciles via the Merkle trie, and joins. Pull-only and
// symmetric — any peer can vanish and nothing is lost or blocked.

function author(root: string, by: string, intent: string, src: string): void {
  const repo = loadRepo(root);
  const names = new Map<string, Hash>([...repo.namespace].map(([n, b]) => [n, b.hash]));
  const binds = compileProgram(src, repo.store, names);
  repo.pending.push({ by, intent, binds: binds.map((b) => ({ name: b.name, hash: b.hash })) });
  mergeRepo(repo);
  saveRepo(root, repo);
}

function fresh(): string {
  const root = mkdtempSync(join(tmpdir(), "strand-transport-"));
  initRepo(root);
  return root;
}

const urlOf = (s: { address(): AddressInfo | string | null }): string =>
  `http://127.0.0.1:${(s.address() as AddressInfo).port}`;

test("a Merkle index round-trips through JSON (the wire format)", () => {
  const idx = buildIndex(["aaa", "bbb", "ccc"]);
  const back = indexFromJSON(JSON.parse(JSON.stringify(indexToJSON(idx))));
  const diff = reconcile(idx, back);
  assert.deepEqual(diff.missingFromA, []);
  assert.deepEqual(diff.missingFromB, []);
  assert.equal(back.root.digest, idx.root.digest);
});

test("two peers converge over HTTP pull gossip", async () => {
  const rootA = fresh();
  const rootB = fresh();
  author(rootA, "agent-a", "add a", "def a -> Int = 1");
  author(rootB, "agent-b", "add b", "def b -> Int = 2");

  // b also carries a hint and a decision note — the whole distributed plane ships
  const repoB = loadRepo(rootB);
  repoB.hints = announce(repoB.hints, "b", "agent-b", 1, 10);
  repoB.memory = record(repoB.memory, {
    type: "convention",
    subject: "ints",
    body: "prefer Int over Nat",
    by: "agent-b",
    targets: ["b"],
  });
  saveRepo(rootB, repoB);

  const serverA = await servePeer(rootA, 0);
  const serverB = await servePeer(rootB, 0);
  try {
    await gossipOnce(rootA, [urlOf(serverB)]);
    await gossipOnce(rootB, [urlOf(serverA)]);

    const a = loadRepo(rootA);
    const b = loadRepo(rootB);
    assert.deepEqual(
      [...a.namespace.keys()].sort(),
      ["a", "b"],
      "A holds both definitions",
    );
    assert.deepEqual(a.namespace, b.namespace, "identical resolved namespaces");
    assert.deepEqual(a.crdt, b.crdt, "identical CRDT state");
    assert.deepEqual(a.hints, b.hints, "hints gossiped");
    assert.deepEqual(a.memory, b.memory, "decision memory gossiped");

    // anti-entropy finds nothing left to exchange
    const diff = reconcile(buildIndex(a.store.hashes()), buildIndex(b.store.hashes()));
    assert.deepEqual(diff.missingFromA, []);
    assert.deepEqual(diff.missingFromB, []);
  } finally {
    serverA.close();
    serverB.close();
  }
});

test("gossip survives an unreachable peer (no SPOF, just skip)", async () => {
  const rootA = fresh();
  author(rootA, "agent-a", "add a", "def a -> Int = 1");
  const before = loadRepo(rootA);
  await gossipOnce(rootA, ["http://127.0.0.1:1"]); // nobody listens there
  const after = loadRepo(rootA);
  assert.deepEqual(after.namespace, before.namespace, "local state untouched");
});

// #49: peer auth — a shared secret closes the transport to strangers.
test("a token-protected peer rejects unauthenticated pulls and serves authenticated ones", async () => {
  const rootA = fresh();
  const rootB = fresh();
  author(rootA, "agent-a", "add add", "def add (a: Int) (b: Int) -> Int = a + b");

  const serverA = await servePeer(rootA, 0, { token: "s3cret" });
  try {
    // wrong token: loud 401 on the wire, zero peers reached in gossip
    const res = await fetch(`${urlOf(serverA)}/index`, { headers: { authorization: "Bearer wrong" } });
    assert.equal(res.status, 401);
    const bare = await fetch(`${urlOf(serverA)}/index`);
    assert.equal(bare.status, 401);

    const denied = await gossipOnce(rootB, [urlOf(serverA)], { token: "wrong" });
    assert.equal(denied.peersReached, 0, "gossip with a bad token reaches nothing");

    // right token: the namespace flows
    const ok = await gossipOnce(rootB, [urlOf(serverA)], { token: "s3cret" });
    assert.equal(ok.peersReached, 1);
    const repo = loadRepo(rootB);
    assert.ok(repo.namespace.has("add"), "definition arrived through the authenticated transport");
  } finally {
    serverA.close();
  }
});
