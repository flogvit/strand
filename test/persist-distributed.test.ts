import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initRepo, loadRepo, saveRepo } from "../src/persist.ts";
import { observe } from "../src/distributed/crdt.ts";
import { announce } from "../src/distributed/hints.ts";
import { record } from "../src/distributed/memory.ts";

// The distributed plane (CRDT namespace, advisory hints, decision memory) must
// survive a process exit: a restarting worker — or a new peer bootstrapping from
// disk — loads exactly the state that was saved.

test("initRepo starts with empty distributed state", () => {
  const root = mkdtempSync(join(tmpdir(), "strand-persist-dist-"));
  initRepo(root);
  const repo = loadRepo(root);
  assert.equal(repo.crdt.size, 0);
  assert.equal(repo.hints.size, 0);
  assert.equal(repo.memory.size, 0);
});

test("CRDT namespace, hints and decision memory round-trip through disk", () => {
  const root = mkdtempSync(join(tmpdir(), "strand-persist-dist-"));
  const repo = initRepo(root);

  repo.crdt = observe(repo.crdt, "signup", { hash: "h1", by: "agent-1", intent: "v1" });
  repo.crdt = observe(repo.crdt, "signup", { hash: "h2", by: "agent-2", intent: "v2" });
  repo.hints = announce(repo.hints, "signup", "agent-1", 1, 10);
  repo.memory = record(repo.memory, {
    type: "assumption",
    subject: "solver",
    body: "task said 'a solver'; assumed backtracking",
    by: "agent-1",
    targets: ["solve"],
  });

  saveRepo(root, repo);
  const loaded = loadRepo(root);

  assert.deepEqual(loaded.crdt, repo.crdt);
  assert.deepEqual(loaded.hints, repo.hints);
  assert.deepEqual(loaded.memory, repo.memory);
});

test("a legacy repo (namespace.json only) lifts its namespace into the CRDT on load", () => {
  const root = mkdtempSync(join(tmpdir(), "strand-persist-dist-"));
  const repo = initRepo(root);
  repo.namespace.set("double", { hash: "hd", by: "agent-1", intent: "doubler" });
  saveRepo(root, repo);
  // simulate a repo written before the distributed plane existed
  rmSync(join(root, ".strand", "crdt.json"));
  assert.ok(!existsSync(join(root, ".strand", "crdt.json")));

  const loaded = loadRepo(root);
  const state = loaded.crdt.get("double");
  assert.ok(state, "namespace binding lifted into CRDT state");
  assert.deepEqual(state!.obs, [{ hash: "hd", by: "agent-1", intent: "doubler" }]);
});
