import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beat, emptyPresence, fromJSON, join as joinP, nodes, toJSON } from "../src/distributed/presence.ts";
import { initRepo, loadRepo, saveRepo } from "../src/persist.ts";
import { servePeer, gossipOnce } from "../src/distributed/transport.ts";
import { FileQueue } from "../src/swarm/queue.ts";
import { work } from "../src/swarm/worker.ts";
import type { Agent, AgentContext, AgentResult } from "../src/swarm/adapter.ts";
import { execFileSync } from "node:child_process";

// #43: presence is CRDT state — same algebra as hints, view keeps latest seq.
test("presence join is a union; nodes() keeps the latest beat per worker with liveness", () => {
  let a = emptyPresence();
  a = beat(a, { workerId: "w1", provider: "claude", currentTask: "3", seq: 1, expiresAt: 11, done: 0, parked: 0 });
  a = beat(a, { workerId: "w1", provider: "claude", currentTask: null, seq: 5, expiresAt: 15, done: 2, parked: 0 });
  let b = emptyPresence();
  b = beat(b, { workerId: "w2", provider: "codex", currentTask: "4", seq: 2, expiresAt: 4, done: 0, parked: 1 });

  const ab = joinP(a, b);
  const ba = joinP(b, a);
  assert.deepEqual(toJSON(ab), toJSON(ba), "join commutes");
  assert.deepEqual(toJSON(joinP(ab, ab)), toJSON(ab), "join is idempotent");

  const view = nodes(ab, 10);
  assert.equal(view.length, 2);
  const w1 = view.find((n) => n.workerId === "w1")!;
  assert.equal(w1.seq, 5, "latest beat wins");
  assert.equal(w1.done, 2);
  assert.equal(w1.alive, true);
  const w2 = view.find((n) => n.workerId === "w2")!;
  assert.equal(w2.alive, false, "TTL-expired beat reads as gone");
  assert.equal(w2.age, 8);

  // wire round-trip
  assert.deepEqual(toJSON(fromJSON(toJSON(ab))), toJSON(ab));
});

test("presence flows through gossip like any other CRDT state", async () => {
  const rootA = mkdtempSync(join(tmpdir(), "strand-presence-a-"));
  const rootB = mkdtempSync(join(tmpdir(), "strand-presence-b-"));
  initRepo(rootA);
  initRepo(rootB);

  const repoA = loadRepo(rootA);
  repoA.presence = beat(repoA.presence, { workerId: "w1", provider: "claude", currentTask: "1", seq: 0, expiresAt: 10, done: 0, parked: 0 });
  saveRepo(rootA, repoA);

  const server = await servePeer(rootA, 0);
  try {
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    await gossipOnce(rootB, [url]);
    const repoB = loadRepo(rootB);
    assert.equal(nodes(repoB.presence, 0).length, 1, "the beat crossed the wire");
    assert.equal(nodes(repoB.presence, 0)[0].workerId, "w1");
  } finally {
    server.close();
  }
});

// The worker loop actually heartbeats: after a run, its presence is on disk.
test("the worker loop leaves presence beats behind", async () => {
  const CLI = join(process.cwd(), "src", "cli.ts");
  const root = mkdtempSync(join(tmpdir(), "strand-presence-w-"));
  execFileSync("npx", ["tsx", CLI, "init"], { env: { ...process.env, STRAND_ROOT: root }, encoding: "utf8" });
  const queue = new FileQueue(join(root, ".strand-swarm"));
  queue.add({ title: "code add", role: "code", intent: "adder", target: ["add"], deps: [] });

  const agent: Agent = {
    provider: "fake",
    run(_ctx: AgentContext): AgentResult {
      return { code: "def add (a: Int) (b: Int) -> Int = a + b", report: "ok" };
    },
  };
  await work(queue, agent, { root, workerId: "w9", maxIdlePolls: 2, pollMs: 5 });

  const repo = loadRepo(root);
  const view = nodes(repo.presence, 0);
  assert.equal(view.length, 1);
  assert.equal(view[0].workerId, "w9");
  assert.equal(view[0].provider, "fake");
  assert.equal(view[0].done, 1);
  assert.equal(view[0].currentTask, null, "finished — not mid-task");
});
