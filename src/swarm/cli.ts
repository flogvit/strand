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

  strand-swarm plan [--queue <dir> | --gh <owner/repo>]
                                                    seed the Sudoku decomposition as tasks
  strand-swarm work --as <id> --provider <name> [--root <dir>] [--queue <dir> | --gh <owner/repo>]
                    [--peers <url,url>] [--poll <ms>] [--idle <n>]
                                                    run a worker until the queue drains
                                                    (exits after n empty polls, ms apart),
                                                    gossiping with the given peers
  strand-swarm status [--queue <dir> | --gh <owner/repo>]
                                                    show the task board

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
      const tasks = seed(queue);
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
      console.log(`${workerId}: ${summary.done.length} done, ${summary.parked.length} parked`);
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
      return 0;
    }

    default:
      console.log(USAGE);
      return cmd ? 1 : 0;
  }
}

process.exit(await main(process.argv.slice(2)));
