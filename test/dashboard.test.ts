import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileQueue } from "../src/swarm/queue.ts";
import { snapshot, startDashboard } from "../src/swarm/dashboard.ts";
import { servePeer } from "../src/distributed/transport.ts";
import { initRepo, loadRepo, saveRepo } from "../src/persist.ts";
import { record } from "../src/distributed/memory.ts";
import { announce } from "../src/distributed/hints.ts";
import { beat } from "../src/distributed/presence.ts";

const CLI = join(process.cwd(), "src", "cli.ts");
const strand = (root: string, args: string[]) =>
  execFileSync("npx", ["tsx", CLI, ...args], { env: { ...process.env, STRAND_ROOT: root }, encoding: "utf8" });

function seededRepo(): { root: string; queue: FileQueue } {
  const root = mkdtempSync(join(tmpdir(), "strand-dash-"));
  strand(root, ["init"]);
  strand(root, ["submit", "--as", "w1", "--intent", "adder", "--code", "def add (a: Int) (b: Int) -> Int = a + b\ndef tst_add -> Bool = add 1 1 == 2"]);
  strand(root, ["merge"]);
  strand(root, ["test"]);
  // a genuine parked conflict: two different bodies for one name
  strand(root, ["submit", "--as", "w1", "--intent", "first", "--code", "def pick -> Int = 1"]);
  strand(root, ["submit", "--as", "w2", "--intent", "second", "--code", "def pick -> Int = 2"]);
  try {
    strand(root, ["merge"]);
  } catch {
    // exit 2 signals the parked conflict — exactly the state we want on the board
  }

  const repo = loadRepo(root);
  repo.hints = announce(repo.hints, "add", "w2", repo.history.length, repo.history.length + 10);
  repo.memory = record(repo.memory, { type: "assumption", subject: "add", body: "ints only", by: "w1", targets: ["add"] });
  repo.presence = beat(repo.presence, { workerId: "w1", provider: "claude", currentTask: null, seq: 1, expiresAt: 99, done: 1, parked: 0 });
  saveRepo(root, repo);

  const queue = new FileQueue(join(root, ".strand-swarm"));
  const t1 = queue.add({ title: "code add", role: "code", intent: "adder", target: ["add"], deps: [] });
  queue.add({ title: "test add", role: "test", intent: "verify", target: ["add"], deps: [t1.id] });
  queue.report(t1.id, { state: "parked", unassign: true, comment: "green-gate rejected: type mismatch" });
  return { root, queue };
}

// #42/#44/#45/#46: the one snapshot the static page renders from.
test("the snapshot aggregates queue, namespace, conflicts, hints, memory and presence", async () => {
  const { root, queue } = seededRepo();
  const snap = await snapshot(root, queue);

  // #44: tasks with deps and the parked reason
  assert.equal(snap.tasks.length, 2);
  const parked = snap.tasks.find((t) => t.state === "parked")!;
  assert.match(parked.lastComment ?? "", /green-gate rejected/);
  assert.deepEqual(snap.tasks[1].deps, [parked.id]);

  // #46: bindings carry type, source, attestations, hints overlay
  const add = snap.bindings.find((b) => b.name === "add")!;
  assert.match(add.type, /Int -> Int -> Int/);
  assert.match(add.source, /def add/);
  assert.ok(add.attested.includes("typecheck"));
  assert.ok(add.attested.includes("tests"));
  assert.deepEqual(add.activeIntents, ["w2"]);
  assert.match(snap.emitTs, /export const add/);
  // parked name conflict with both contender bodies
  const conflict = snap.conflicts.find((c) => c.name === "pick")!;
  assert.equal(conflict.contenders.length, 2);
  assert.ok(conflict.contenders.every((k) => /def pick/.test(k.source)));

  // #45: memory notes with active ids
  assert.ok(snap.memory.notes.some((n) => n.type === "assumption" && n.subject === "add"));
  assert.equal(snap.memory.activeIds.length, snap.memory.notes.filter((n) => n.type === "assumption").length + snap.memory.notes.filter((n) => n.type !== "assumption").length);

  // #43: presence view
  assert.equal(snap.presence.length, 1);
  assert.equal(snap.presence[0].workerId, "w1");

  // merkle self-digest present
  assert.ok(snap.merkle.self.length > 0);
});

test("the dashboard serves the page and the snapshot; convergence strip sees a peer", async () => {
  const { root, queue } = seededRepo();
  const peer = await servePeer(root, 0); // a peer with identical state: converged by definition
  const peerUrl = `http://127.0.0.1:${(peer.address() as { port: number }).port}`;
  const { server, stop } = await startDashboard({ root, port: 0, queue, peers: [peerUrl], gossipMs: 60_000 });
  try {
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const page = await (await fetch(base + "/")).text();
    assert.match(page, /strand swarm/);
    assert.match(page, /namespace/);
    const snap = await (await fetch(base + "/api/snapshot")).json();
    assert.equal(snap.merkle.peers.length, 1);
    assert.equal(snap.merkle.peers[0].root, snap.merkle.self, "identical stores converge");
  } finally {
    stop();
    peer.close();
  }
});

// the observer is read-only: a full snapshot leaves the repo untouched
test("observing writes nothing", async () => {
  const { root, queue } = seededRepo();
  const before = JSON.stringify(loadRepo(root).namespace.size) + strand(root, ["log"]);
  await snapshot(root, queue);
  const after = JSON.stringify(loadRepo(root).namespace.size) + strand(root, ["log"]);
  assert.equal(after, before);
});
