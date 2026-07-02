import { join } from "node:path";
import { agentFor } from "./adapter.ts";
import { FileQueue, type Queue } from "./queue.ts";
import { GhQueue } from "./ghqueue.ts";
import { seed } from "./plan.ts";
import { work } from "./worker.ts";

/** strand-swarm — the orchestration overbygg. A shared task queue feeds
 *  provider-agnostic workers that author into a Strand store through the green-gate.
 *  Give the network a task (`plan`), start workers (`work`), watch it (`status`). */

interface Args {
  positionals: string[];
  opts: Record<string, string>;
}

function parseArgs(argv: string[]): Args {
  const positionals: string[] = [];
  const opts: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const hasVal = argv[i + 1] !== undefined && !argv[i + 1].startsWith("--");
      opts[key] = hasVal ? argv[++i] : "true";
    } else {
      positionals.push(a);
    }
  }
  return { positionals, opts };
}

const USAGE = `strand-swarm — autonomous, provider-agnostic agent orchestration

  strand-swarm plan [--queue <dir> | --gh <owner/repo>] [--require-tests]
                                                    seed the Sudoku decomposition as tasks
                                                    (--require-tests gates every landed def
                                                    on attested tests — verify is then done)
  strand-swarm work --as <id> --provider <name> [--root <dir>] [--queue <dir> | --gh <owner/repo>]
                    [--peers <url,url>] [--poll <ms>] [--idle <n>]
                                                    run a worker until the queue drains
                                                    (exits after n empty polls, ms apart),
                                                    gossiping with the given peers
  strand-swarm status [--queue <dir> | --gh <owner/repo>]
                                                    show the task board
  strand-swarm coverage [--root <dir>] [--queue <dir> | --gh <owner/repo>] [--require]
                                                    open a test task per untested definition
                                                    (--require also gates each on 'tests'
                                                    so strand verify becomes the hard gate)

  providers: claude | codex | gemini
  queues:    a local dir (default) or GitHub issues via --gh — the shared board
             agents on any machine pull from and a human can add to mid-run
  defaults:  --root = $STRAND_ROOT or cwd;  --queue = <root>/.strand-swarm
`;

async function main(argv: string[]): Promise<number> {
  const { positionals, opts } = parseArgs(argv);
  const cmd = positionals[0];
  const root = opts.root ?? process.env.STRAND_ROOT ?? process.cwd();
  const queueDir = opts.queue ?? join(root, ".strand-swarm");
  const queue: Queue = opts.gh ? new GhQueue({ repo: opts.gh }) : new FileQueue(queueDir);
  const queueName = opts.gh ? `github:${opts.gh}` : queueDir;

  switch (cmd) {
    case "plan": {
      const { repoExists } = await import("../persist.ts");
      const tasks = seed(queue, undefined, repoExists(root) ? root : undefined, {
        requireTests: opts["require-tests"] === "true",
      });
      console.log(`seeded ${tasks.length} tasks into ${queueName}`);
      return 0;
    }

    case "work": {
      const workerId = opts.as;
      const provider = opts.provider;
      if (!workerId || !provider) {
        console.error("work requires --as <id> and --provider <name>");
        return 2;
      }
      const peers = opts.peers ? opts.peers.split(",").map((p) => p.trim()).filter(Boolean) : [];
      const summary = await work(queue, agentFor(provider), {
        root,
        workerId,
        peers,
        maxIdlePolls: opts.idle ? Number(opts.idle) : undefined,
        pollMs: opts.poll ? Number(opts.poll) : undefined,
      });
      const ph = summary.provider;
      const health =
        ph.timeouts + ph.transient + ph.permanent > 0
          ? `, provider: ${ph.timeouts} timeout / ${ph.transient} transient / ${ph.permanent} permanent`
          : "";
      console.log(`${workerId}: ${summary.done.length} done, ${summary.parked.length} parked${health}`);
      if (summary.stopped) {
        console.error(`${workerId} stopped early: ${summary.stopped}`);
        return 1;
      }
      return 0;
    }

    case "coverage": {
      // #41: the coverage loop. The swarm's own byproducts (agent-invented
      // helpers no planner ever named) come under test without a human
      // noticing them first: every untested definition becomes a test task.
      const { loadRepo, saveRepo } = await import("../persist.ts");
      const { untestedOf } = await import("../project.ts");
      const repo = loadRepo(root);
      const untested = untestedOf(repo.namespace, repo.store);
      if (untested.length === 0) {
        console.log("all definitions are covered by a test — nothing to seed");
        return 0;
      }
      const existing = new Set(
        queue.list().filter((t) => t.role === "test").flatMap((t) => t.target),
      );
      let opened = 0;
      for (const name of untested) {
        if (existing.has(name)) continue;
        queue.add({
          title: `test ${name}`,
          role: "test",
          intent: `coverage: verify ${name} (opened by the coverage loop, no test reaches it)`,
          target: [name],
          helperPrefix: name,
          deps: [],
        });
        opened++;
        if (opts.require) {
          const b = repo.namespace.get(name)!;
          const req = new Set([...(b.requires ?? []), "tests"]);
          b.requires = [...req];
          repo.namespace.set(name, b);
        }
      }
      if (opts.require) saveRepo(root, repo);
      console.log(
        `coverage: ${untested.length} untested definition(s), opened ${opened} test task(s)` +
          (untested.length - opened > 0 ? ` (${untested.length - opened} already queued)` : "") +
          (opts.require ? ", each now requires 'tests'" : ""),
      );
      return 0;
    }

    case "status": {
      const tasks = queue.list();
      const by = (s: string) => tasks.filter((t) => t.state === s).length;
      console.log(`tasks: ${tasks.length}  ready:${by("ready")} done:${by("done")} parked:${by("parked")} blocked:${by("blocked")}`);
      for (const t of tasks) {
        const who = t.assignee ? ` @${t.assignee}` : "";
        console.log(`  [${t.state}] #${t.id} ${t.role} ${t.target.join(",")}${who}`);
      }
      // #51: the board reports attestation state — done should mean attested.
      const { repoExists, loadRepo } = await import("../persist.ts");
      if (repoExists(root)) {
        const repo = loadRepo(root);
        let required = 0;
        let green = 0;
        const red: string[] = [];
        for (const [name, b] of repo.namespace) {
          const req = b.requires ?? [];
          if (req.length === 0) continue;
          required++;
          const attested = new Set(repo.attestations[b.hash] ?? []);
          if (req.every((c) => attested.has(c))) green++;
          else red.push(name);
        }
        if (required > 0) {
          console.log(`attested: ${green}/${required} required definitions green${red.length ? ` — missing: ${red.sort().join(", ")}` : ""}`);
        }
      }
      return 0;
    }

    default:
      console.log(USAGE);
      return cmd ? 1 : 0;
  }
}

process.exit(await main(process.argv.slice(2)));
