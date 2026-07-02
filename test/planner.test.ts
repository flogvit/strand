import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { buildPlanPrompt, extractPlanJson, planGoal, planShape, validatePlan } from "../src/swarm/planner.ts";
import { seed } from "../src/swarm/plan.ts";
import { FileQueue } from "../src/swarm/queue.ts";
import { loadRepo } from "../src/persist.ts";
import { forTarget } from "../src/distributed/memory.ts";

// #39: the planner as an agent — validation catches broken plans before seeding.
test("validatePlan: orders topologically, rejects dups, unknown deps and cycles", () => {
  const ok = validatePlan([
    { name: "join", intent: "join strings", deps: ["sep"] },
    { name: "sep", intent: "separator", deps: [] },
  ]);
  assert.deepEqual(ok.map((s) => s.name), ["sep", "join"], "dependency order regardless of input order");
  assert.equal(ok[1].helperPrefix, "join", "planner assigns the helper prefix mechanically (#52)");

  assert.throws(() => validatePlan([]), /non-empty/);
  assert.throws(() => validatePlan([{ name: "a", intent: "x", deps: [] }, { name: "a", intent: "y", deps: [] }]), /duplicate name 'a'/);
  assert.throws(() => validatePlan([{ name: "a", intent: "x", deps: ["ghost"] }]), /'ghost', which the plan never defines/);
  assert.throws(() => validatePlan([
    { name: "a", intent: "x", deps: ["b"] },
    { name: "b", intent: "y", deps: ["a"] },
  ]), /cycle: /);
  assert.throws(() => validatePlan([{ name: "9bad", intent: "x", deps: [] }]), /bad name/);
});

test("planShape reports width, critical path and hot names", () => {
  const shape = planShape(validatePlan([
    { name: "base", intent: "shared model", deps: [] },
    { name: "f", intent: "one", deps: ["base"] },
    { name: "g", intent: "two", deps: ["base"] },
    { name: "h", intent: "three", deps: ["base"] },
    { name: "top", intent: "driver", deps: ["f", "g", "h"] },
  ]));
  assert.equal(shape.defs, 5);
  assert.equal(shape.criticalPath, 3);
  assert.equal(shape.width, 3);
  assert.equal(shape.hot[0].name, "base");
  assert.equal(shape.hot[0].fanIn, 3);
});

test("planGoal: model JSON -> validated specs; specs seed tasks and pin spec notes", () => {
  const reply = [
    "Here is the plan:",
    "```json",
    JSON.stringify([
      { name: "textJoin", intent: "join a list of texts with a separator", deps: ["textIntercalate"], spec: "textJoin : Text -> List Text -> Text" },
      { name: "textIntercalate", intent: "fold with separator", deps: [] },
    ]),
    "```",
  ].join("\n");
  const fakeRun = () => reply;
  const { specs, shape } = planGoal("text utilities", "claude", fakeRun);
  assert.deepEqual(specs.map((s) => s.name), ["textIntercalate", "textJoin"]);
  assert.equal(shape.defs, 2);
  assert.match(buildPlanPrompt("text utilities"), /Goal: text utilities/);
  assert.equal(extractPlanJson("```json\n[1]\n```"), "[1]");

  // seed the validated plan like any hand seed: tasks + spec notes
  const root = mkdtempSync(join(tmpdir(), "strand-planner-"));
  const CLI = join(process.cwd(), "src", "cli.ts");
  execFileSync("npx", ["tsx", CLI, "init"], { env: { ...process.env, STRAND_ROOT: root }, encoding: "utf8" });
  const queue = new FileQueue(join(root, ".strand-swarm"));
  const tasks = seed(queue, specs, root);
  assert.equal(tasks.length, 4, "code + test task per def");
  const codeJoin = tasks.find((t) => t.role === "code" && t.target.includes("textJoin"))!;
  assert.equal(codeJoin.helperPrefix, "textJoin");
  const notes = forTarget(loadRepo(root).memory, "textJoin");
  assert.ok(notes.some((n) => n.type === "spec" && /List Text -> Text/.test(n.body)), "pinned spec landed as a note");
});
