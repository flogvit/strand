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
  { name: "hero", intent: "hero section", deps: ["tag"], test: false },
];

test("seeding with a root records pinned specs as decision-memory notes", () => {
  const root = mkdtempSync(join(tmpdir(), "strand-plan-spec-"));
  initRepo(root);
  const queue = new FileQueue(join(root, ".strand-swarm"));

  const tasks = seed(queue, DEFS, root);
  assert.equal(tasks.length, 5, "code task per def + test task only where test !== false");
  assert.ok(!tasks.some((t) => t.role === "test" && t.target.includes("hero")), "oracle-verified defs get no test task");

  const repo = loadRepo(root);
  const tagNotes = forTarget(repo.memory, "tag");
  assert.equal(tagNotes.length, 2, "pinned spec + the helper-naming convention (#52)");
  const spec = tagNotes.find((n) => n.type === "spec")!;
  assert.match(spec.body, /Text -> Text -> Text -> Text/);
  assert.ok(tagNotes.some((n) => n.type === "convention" && n.subject === "helper naming"));

  const heroNotes = forTarget(repo.memory, "hero");
  assert.equal(heroNotes.length, 1, "no spec fabricated — only the naming convention");
  assert.equal(heroNotes[0].type, "convention");
});

test("seeding without a root behaves exactly as before", () => {
  const root = mkdtempSync(join(tmpdir(), "strand-plan-spec-"));
  initRepo(root);
  const queue = new FileQueue(join(root, ".strand-swarm"));
  const tasks = seed(queue, DEFS);
  assert.equal(tasks.length, 5);
  assert.equal(loadRepo(root).memory.size, 0);
});
