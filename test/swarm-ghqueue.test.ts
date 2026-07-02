import { test } from "node:test";
import assert from "node:assert/strict";
import { GhQueue, type GhRunner } from "../src/swarm/ghqueue.ts";

// The GitHub-issues queue backend: the shared, add-while-running coordination
// point. These tests run against a tiny in-memory GitHub — a fake `gh` runner
// that honors the exact commands GhQueue issues — so they exercise GhQueue's
// protocol (labels, assignment, claim-verify, stale TTL) without the network.

interface FakeIssue {
  number: number;
  title: string;
  body: string;
  labels: string[];
  assignees: string[];
  state: "open" | "closed";
  comments: string[];
}

/** A minimal GitHub: just enough `gh` surface for GhQueue. */
function fakeGh(): { runner: GhRunner; issues: FakeIssue[]; now: () => number; tick: (ms: number) => void } {
  const issues: FakeIssue[] = [];
  let clock = 1_000_000;

  const runner: GhRunner = (args: string[]) => {
    const cmd = args.slice(0, 2).join(" ");

    if (cmd === "issue create") {
      const title = args[args.indexOf("--title") + 1];
      const body = args[args.indexOf("--body") + 1];
      const labels = args.flatMap((a, i) => (args[i - 1] === "--label" ? a.split(",") : []));
      const number = issues.length + 1;
      issues.push({ number, title, body, labels, assignees: [], state: "open", comments: [] });
      return `https://github.com/o/r/issues/${number}`;
    }

    if (cmd === "issue list") {
      return JSON.stringify(
        issues.map((i) => ({
          number: i.number,
          title: i.title,
          body: i.body,
          labels: i.labels.map((name) => ({ name })),
          assignees: i.assignees.map((login) => ({ login })),
          state: i.state.toUpperCase(),
        })),
      );
    }

    if (cmd === "issue edit") {
      const n = Number(args[2]);
      const issue = issues.find((i) => i.number === n)!;
      for (let i = 3; i < args.length; i += 2) {
        const flag = args[i];
        const value = args[i + 1];
        if (flag === "--add-label") {
          for (const l of value.split(",")) if (!issue.labels.includes(l)) issue.labels.push(l);
        } else if (flag === "--remove-label") {
          issue.labels = issue.labels.filter((l) => !value.split(",").includes(l));
        } else if (flag === "--add-assignee") {
          if (!issue.assignees.includes(value)) issue.assignees.push(value);
        } else if (flag === "--remove-assignee") {
          issue.assignees = issue.assignees.filter((a) => a !== value);
        }
      }
      return "";
    }

    if (cmd === "issue comment") {
      const n = Number(args[2]);
      issues.find((i) => i.number === n)!.comments.push(args[args.indexOf("--body") + 1]);
      return "";
    }

    if (cmd === "issue close") {
      const n = Number(args[2]);
      issues.find((i) => i.number === n)!.state = "closed";
      return "";
    }

    throw new Error(`fake gh: unhandled ${args.join(" ")}`);
  };

  return { runner, issues, now: () => clock, tick: (ms) => (clock += ms) };
}

function queueWith(gh: ReturnType<typeof fakeGh>, opts: { claimTtlMs?: number } = {}): GhQueue {
  return new GhQueue({ repo: "o/r", runner: gh.runner, now: gh.now, claimTtlMs: opts.claimTtlMs });
}

test("add opens a labeled issue and returns the task", () => {
  const gh = fakeGh();
  const q = queueWith(gh);
  const t = q.add({ title: "code add", role: "code", intent: "adder", target: ["add"], deps: [] });

  assert.equal(t.id, "1");
  assert.equal(t.state, "ready");
  const issue = gh.issues[0];
  assert.ok(issue.labels.includes("strand-task"));
  assert.ok(issue.labels.includes("role:code"));
  assert.ok(issue.labels.includes("state:ready"));
});

test("list round-trips tasks (role, state, targets, deps) through issues", () => {
  const gh = fakeGh();
  const q = queueWith(gh);
  const a = q.add({ title: "code add", role: "code", intent: "adder", target: ["add"], deps: [] });
  q.add({ title: "test add", role: "test", intent: "verify add", target: ["add"], deps: [a.id] });

  const tasks = q.list();
  assert.equal(tasks.length, 2);
  assert.deepEqual(tasks[1].deps, [a.id]);
  assert.equal(tasks[1].role, "test");
  assert.deepEqual(tasks[1].target, ["add"]);
});

test("claim assigns atomically and respects dependency gating", () => {
  const gh = fakeGh();
  const q = queueWith(gh);
  const a = q.add({ title: "code add", role: "code", intent: "adder", target: ["add"], deps: [] });
  q.add({ title: "code double", role: "code", intent: "doubler", target: ["double"], deps: [a.id] });

  const first = q.claim("w1");
  assert.equal(first!.id, a.id, "the dep-free task is claimed first");
  assert.equal(q.claim("w2"), undefined, "double is gated on add being done");

  q.report(a.id, { state: "done", comment: "landed" });
  const second = q.claim("w2");
  assert.equal(second!.id, "2", "done dep unblocks the dependent task");
  assert.equal(gh.issues[0].state, "closed", "a done task's issue closes");
});

test("a claimed task is not claimable by another worker", () => {
  const gh = fakeGh();
  const q = queueWith(gh);
  q.add({ title: "code add", role: "code", intent: "adder", target: ["add"], deps: [] });
  assert.ok(q.claim("w1"));
  assert.equal(q.claim("w2"), undefined);
});

test("a stale claim (crashed worker) is reclaimable after the TTL", () => {
  const gh = fakeGh();
  const q = queueWith(gh, { claimTtlMs: 1000 });
  q.add({ title: "code add", role: "code", intent: "adder", target: ["add"], deps: [] });

  assert.ok(q.claim("w1"), "w1 claims, then crashes");
  assert.equal(q.claim("w2"), undefined, "claim is live inside the TTL");

  gh.tick(2000);
  const reclaimed = q.claim("w2");
  assert.ok(reclaimed, "expired claim is reclaimable");
  assert.equal(reclaimed!.assignee, "w2");
});

test("report parks with a comment and frees the task for reclaim", () => {
  const gh = fakeGh();
  const q = queueWith(gh);
  const t = q.add({ title: "code add", role: "code", intent: "adder", target: ["add"], deps: [] });
  q.claim("w1");
  q.report(t.id, { state: "ready", unassign: true, comment: "green-gate rejected" });

  const issue = gh.issues[0];
  assert.ok(issue.comments.some((c) => c.includes("green-gate rejected")));
  assert.deepEqual(issue.assignees, []);
  assert.ok(q.claim("w2"), "freed task is claimable again");
});
