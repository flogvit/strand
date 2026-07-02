import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initRepo, loadRepo } from "../src/persist.ts";
import { forTarget } from "../src/distributed/memory.ts";
import { FileQueue } from "../src/swarm/queue.ts";
import { seed, type DefSpec } from "../src/swarm/plan.ts";

// The planner pins shared contracts: a DefSpec may carry a `spec` (signature +
// contract), and seeding records it as a first-class spec note in the repo's
// decision memory — the workers already read forTarget() into agent prompts,
// so every agent building on `tag` sees the same pinned API instead of
// inventing its own. This closes the divergence gap the Sudoku runs exposed
// (all three runs happened to agree on `generate : Int -> Grid`; nothing made
// them).

const DEFS: DefSpec[] = [
  { name: "escapeHtml", intent: "escape &<>\"", deps: [], spec: "escapeHtml : Text -> Text — replaces & < > \" with entities" },
  { name: "tag", intent: "build an element", deps: ["escapeHtml"], spec: "tag : Text -> Text -> Text -> Text — tag name, raw attrs, children" },
  { name: "hero", intent: "hero section", deps: ["tag"] },
];

test("seeding with a root records pinned specs as decision-memory notes", () => {
  const root = mkdtempSync(join(tmpdir(), "strand-plan-spec-"));
  initRepo(root);
  const queue = new FileQueue(join(root, ".strand-swarm"));

  const tasks = seed(queue, DEFS, root);
  assert.equal(tasks.length, 6, "code + test task per def, as before");

  const repo = loadRepo(root);
  const tagNotes = forTarget(repo.memory, "tag");
  assert.equal(tagNotes.length, 1);
  assert.equal(tagNotes[0].type, "spec");
  assert.match(tagNotes[0].body, /Text -> Text -> Text -> Text/);

  const heroNotes = forTarget(repo.memory, "hero");
  assert.equal(heroNotes.length, 0, "no spec pinned, no note fabricated");
});

test("seeding without a root behaves exactly as before", () => {
  const root = mkdtempSync(join(tmpdir(), "strand-plan-spec-"));
  initRepo(root);
  const queue = new FileQueue(join(root, ".strand-swarm"));
  const tasks = seed(queue, DEFS);
  assert.equal(tasks.length, 6);
  assert.equal(loadRepo(root).memory.size, 0);
});
