import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initRepo, loadRepo, saveRepo, type RepoState } from "../src/persist.ts";
import { mergeRepo, resolveRepo } from "../src/repo.ts";
import { compileProgram } from "../src/pipeline.ts";
import { view } from "../src/distributed/crdt.ts";
import type { Hash } from "../src/core/term.ts";

// One merge, not two: the repo's merge path runs on the CRDT (observe + join +
// view), so local and distributed merges agree by construction. The resolved
// namespace and the parked conflicts are *derived* from the CRDT view.

function submit(repo: RepoState, by: string, intent: string, src: string): Hash[] {
  const names = new Map<string, Hash>([...repo.namespace].map(([n, b]) => [n, b.hash]));
  const binds = compileProgram(src, repo.store, names);
  repo.pending.push({ by, intent, binds: binds.map((b) => ({ name: b.name, hash: b.hash })) });
  return binds.map((b) => b.hash);
}

function freshRepo(): RepoState {
  return initRepo(mkdtempSync(join(tmpdir(), "strand-repo-crdt-")));
}

test("merge observes into the CRDT and derives the namespace from its view", () => {
  const repo = freshRepo();
  submit(repo, "agent-1", "add a", "def a -> Int = 1");
  const r = mergeRepo(repo);

  assert.deepEqual(r.applied, ["a"]);
  const state = repo.crdt.get("a");
  assert.ok(state && state.obs.length === 1, "the bind landed as a CRDT observation");
  assert.equal(repo.namespace.get("a")!.hash, state!.obs[0].hash);
  assert.deepEqual(view(repo.crdt).namespace, new Map([...repo.namespace].map(([n, b]) => [n, { hash: b.hash, intent: b.intent, by: b.by }])));
});

test("a lone rebind supersedes the old binding (update, not park)", () => {
  const repo = freshRepo();
  submit(repo, "agent-1", "foo v1", "def foo -> Int = 1");
  mergeRepo(repo);
  const [h2] = submit(repo, "agent-1", "foo v2", "def foo -> Int = 2");
  const r = mergeRepo(repo);

  assert.deepEqual(r.applied, ["foo"]);
  assert.equal(r.conflicts.length, 0);
  assert.equal(repo.namespace.get("foo")!.hash, h2);
  // both versions remain as observations; the update is a supersession
  assert.equal(repo.crdt.get("foo")!.obs.length, 2);
  assert.equal(repo.crdt.get("foo")!.resolution!.hash, h2);
});

test("same-round contention parks, derived from the CRDT view", () => {
  const repo = freshRepo();
  submit(repo, "agent-1", "signup v1", "def signup -> Int = 1");
  submit(repo, "agent-2", "signup v2", "def signup -> Int = 2");
  const r = mergeRepo(repo);

  assert.equal(r.conflicts.length, 1);
  assert.equal(r.conflicts[0].name, "signup");
  assert.ok(!repo.namespace.has("signup"));
  assert.deepEqual(repo.conflicts, view(repo.crdt).conflicts);
});

test("resolveRepo settles a park and the resolution round-trips through disk", () => {
  const root = mkdtempSync(join(tmpdir(), "strand-repo-crdt-"));
  const repo = initRepo(root);
  submit(repo, "agent-1", "signup v1", "def signup -> Int = 1");
  const [h2] = submit(repo, "agent-2", "signup v2", "def signup -> Int = 2");
  mergeRepo(repo);
  resolveRepo(repo, "signup", h2, "human");
  saveRepo(root, repo);

  const loaded = loadRepo(root);
  assert.equal(loaded.namespace.get("signup")!.hash, h2);
  assert.deepEqual(view(loaded.crdt).conflicts, []);
});

test("resolving to a non-contender hash is an explicit error", () => {
  const repo = freshRepo();
  submit(repo, "agent-1", "signup v1", "def signup -> Int = 1");
  submit(repo, "agent-2", "signup v2", "def signup -> Int = 2");
  mergeRepo(repo);
  assert.throws(() => resolveRepo(repo, "signup", "nope", "human"), /not a contender/);
});

test("requires annotations survive a merge-derived namespace", () => {
  const repo = freshRepo();
  submit(repo, "agent-1", "add a", "def a -> Int = 1");
  mergeRepo(repo);
  repo.namespace.get("a")!.requires = ["tests"];

  submit(repo, "agent-1", "add b", "def b -> Int = 2");
  mergeRepo(repo);
  assert.deepEqual(repo.namespace.get("a")!.requires, ["tests"]);
});

test("a legacy repo's parked conflicts lift into the CRDT on load", () => {
  const root = mkdtempSync(join(tmpdir(), "strand-repo-crdt-"));
  const repo = initRepo(root);
  repo.conflicts = [
    {
      name: "x",
      base: null,
      contenders: [
        { by: "agent-1", hash: "h1", intent: "v1" },
        { by: "agent-2", hash: "h2", intent: "v2" },
      ],
    },
  ];
  saveRepo(root, repo);
  rmSync(join(root, ".strand", "crdt.json"));

  const loaded = loadRepo(root);
  assert.equal(loaded.crdt.get("x")!.obs.length, 2, "legacy contenders are CRDT observations");
});
