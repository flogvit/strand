import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileQueue } from "../src/swarm/queue.ts";
import { work } from "../src/swarm/worker.ts";
import { servePeer } from "../src/distributed/transport.ts";
import { loadRepo } from "../src/persist.ts";
import type { Agent, AgentContext, AgentResult } from "../src/swarm/adapter.ts";
import type { AddressInfo } from "node:net";

// Two machines, two workers, one green namespace. Machine B's task references a
// definition only machine A has authored; gossip under the worker loop pulls it
// across before B's agent runs, so the work lands green instead of parking.

const CLI = join(process.cwd(), "src", "cli.ts");

function strand(root: string, args: string[]): string {
  return execFileSync("npx", ["tsx", CLI, ...args], {
    env: { ...process.env, STRAND_ROOT: root },
    encoding: "utf8",
  });
}

class FakeAgent implements Agent {
  readonly provider = "fake";
  constructor(private readonly bodies: Record<string, string>) {}
  run(ctx: AgentContext): AgentResult {
    const code = ctx.task.target.map((t) => this.bodies[t] ?? "").join("\n");
    return { code, report: "fake" };
  }
}

const urlOf = (s: { address(): AddressInfo | string | null }): string =>
  `http://127.0.0.1:${(s.address() as AddressInfo).port}`;

test("two workers on two machines converge on the same green namespace", async () => {
  const rootA = mkdtempSync(join(tmpdir(), "strand-mm-a-"));
  const rootB = mkdtempSync(join(tmpdir(), "strand-mm-b-"));
  strand(rootA, ["init"]);
  strand(rootB, ["init"]);

  // machine A authors `add`
  const queueA = new FileQueue(join(rootA, ".strand-swarm"));
  queueA.add({ title: "code add", role: "code", intent: "adder", target: ["add"], deps: [] });
  const summaryA = await work(
    queueA,
    new FakeAgent({ add: "def add (a: Int) (b: Int) -> Int = a + b" }),
    { root: rootA, workerId: "wa", maxIdlePolls: 1, pollMs: 5 },
  );
  assert.equal(summaryA.done.length, 1, "A landed add");

  const serverA = await servePeer(rootA, 0);
  const serverB = await servePeer(rootB, 0);
  try {
    // machine B's task builds on A's definition — only gossip can make it green
    const queueB = new FileQueue(join(rootB, ".strand-swarm"));
    queueB.add({ title: "code double", role: "code", intent: "doubler", target: ["double"], deps: [] });
    const summaryB = await work(
      queueB,
      new FakeAgent({ double: "def double (n: Int) -> Int = add n n" }),
      { root: rootB, workerId: "wb", maxIdlePolls: 1, pollMs: 5, peers: [urlOf(serverA)] },
    );
    assert.equal(summaryB.done.length, 1, "B landed double against A's add");
    assert.equal(strand(rootB, ["eval", "double 21"]).trim(), "42");

    // one more worker round on A (empty queue, but it gossips from B) → convergence
    await work(queueA, new FakeAgent({}), {
      root: rootA,
      workerId: "wa",
      maxIdlePolls: 1,
      pollMs: 5,
      peers: [urlOf(serverB)],
    });
    const a = loadRepo(rootA);
    const b = loadRepo(rootB);
    assert.deepEqual(a.namespace, b.namespace, "identical namespaces on both machines");
    assert.equal(strand(rootA, ["eval", "double 21"]).trim(), "42");
  } finally {
    serverA.close();
    serverB.close();
  }
});
