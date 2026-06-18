import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assemble } from "./assemble.ts";
import { typecheckModule } from "./typecheck.ts";
import { GreenGateError, submit } from "./engine.ts";
import { mergeTs, resolveConflict } from "./merge.ts";
import { initRepo, loadRepo, repoExists, saveRepo } from "./persist.ts";

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

const USAGE = `strand-ts — Strand's conflict-free substrate over real TypeScript

  strand-ts init
  strand-ts submit --as <author> --intent "<why>" (--file <f.ts> | --code "<src>")
  strand-ts merge
  strand-ts ls
  strand-ts show <name>
  strand-ts build [--out <file>]    # assemble the namespace into one TS module
  strand-ts eval "<expr>"           # assemble + evaluate an expression via tsx
  strand-ts conflicts
  strand-ts resolve <name> <hash>
`;

class CliError extends Error {}

function need(root: string): void {
  if (!repoExists(root)) throw new CliError("no .strand-ts repo here — run `strand-ts init` first");
}

function main(argv: string[]): number {
  const { positionals, opts } = parseArgs(argv);
  const cmd = positionals[0];
  const root = process.env.STRAND_ROOT ?? process.cwd();

  switch (cmd) {
    case "init": {
      if (repoExists(root)) {
        console.log(".strand-ts already exists");
        return 0;
      }
      initRepo(root);
      console.log("initialized empty Strand-over-TypeScript repo in .strand-ts/");
      return 0;
    }

    case "submit": {
      need(root);
      const by = opts.as;
      if (!by) throw new CliError("submit needs --as <author>");
      const intent = opts.intent ?? "";
      const src = opts.code ?? (opts.file ? readFileSync(opts.file, "utf8") : undefined);
      if (src === undefined) throw new CliError('submit needs --file <path> or --code "<src>"');
      const repo = loadRepo(root);
      try {
        const tx = submit(repo, by, intent, src);
        saveRepo(root, repo);
        console.log(`submitted by ${by}: ${tx.binds.map((b) => `${b.name}=${b.hash}`).join(", ")}`);
        return 0;
      } catch (e) {
        if (e instanceof GreenGateError) {
          console.error(e.message);
          return 1;
        }
        throw e;
      }
    }

    case "merge": {
      need(root);
      const repo = loadRepo(root);
      const result = mergeTs(repo.namespace, repo.store, repo.pending);
      repo.namespace = result.namespace;
      repo.conflicts.push(...result.conflicts);
      repo.pending = [];
      saveRepo(root, repo);
      console.log(`applied  : ${result.applied.sort().join(", ") || "none"}`);
      console.log(`conflicts: ${result.conflicts.map((c) => c.name).join(", ") || "none"}`);
      console.log(`rejected : ${result.rejected.map((r) => `${r.name}(${r.reason})`).join(", ") || "none"}`);
      // whole-namespace green-gate: catch cross-file breaks between individually-green submissions
      const diags = typecheckModule(assemble(repo.namespace, repo.store));
      if (diags.length > 0) {
        console.log(`green-gate: RED`);
        for (const d of diags) console.log(`  ${d}`);
      } else {
        console.log(`green-gate: green`);
      }
      return result.conflicts.length > 0 || diags.length > 0 ? 2 : 0;
    }

    case "ls": {
      need(root);
      const repo = loadRepo(root);
      console.log("namespace:");
      for (const [name, b] of [...repo.namespace].sort((a, z) => a[0].localeCompare(z[0]))) {
        const def = repo.store.get(b.hash);
        console.log(`  ${name.padEnd(16)} [${(def?.kind ?? "?").padEnd(8)}] ${b.hash}  — ${b.intent} (${b.by})`);
      }
      if (repo.conflicts.length) {
        console.log("\nparked conflicts:");
        for (const c of repo.conflicts) {
          console.log(`  ${c.name}  (base ${c.base ?? "∅"})`);
          for (const k of c.contenders) console.log(`     ↳ ${k.by}: ${k.hash} — ${k.intent}`);
        }
      }
      return 0;
    }

    case "show": {
      need(root);
      const name = positionals[1];
      if (!name) throw new CliError("show needs a <name>");
      const repo = loadRepo(root);
      const b = repo.namespace.get(name);
      if (!b) throw new CliError(`no such name '${name}'`);
      console.log(repo.store.get(b.hash)!.text);
      return 0;
    }

    case "build": {
      need(root);
      const repo = loadRepo(root);
      const module = assemble(repo.namespace, repo.store);
      if (opts.out) {
        writeFileSync(opts.out, module);
        console.log(`wrote ${opts.out}`);
      } else {
        process.stdout.write(module);
      }
      return 0;
    }

    case "eval": {
      need(root);
      const expr = positionals[1];
      if (!expr) throw new CliError('eval needs an expression, e.g. eval "double(21)"');
      const repo = loadRepo(root);
      const module = assemble(repo.namespace, repo.store) + `\nconsole.log(${expr});\n`;
      const file = join(root, ".strand-ts", "_run.ts");
      writeFileSync(file, module);
      process.stdout.write(execFileSync("npx", ["tsx", file], { encoding: "utf8" }));
      return 0;
    }

    case "conflicts": {
      need(root);
      const repo = loadRepo(root);
      if (repo.conflicts.length === 0) {
        console.log("no parked conflicts");
        return 0;
      }
      for (const c of repo.conflicts) {
        console.log(`${c.name}  (base ${c.base ?? "∅"})`);
        for (const k of c.contenders) console.log(`   ${k.by}: ${k.hash} — ${k.intent}`);
      }
      return 0;
    }

    case "resolve": {
      need(root);
      const name = positionals[1];
      const hash = positionals[2];
      if (!name || !hash) throw new CliError("resolve needs <name> <hash>");
      const repo = loadRepo(root);
      const conflict = repo.conflicts.find((c) => c.name === name);
      if (!conflict) throw new CliError(`no parked conflict for '${name}'`);
      repo.namespace = resolveConflict(repo.namespace, conflict, hash);
      repo.conflicts = repo.conflicts.filter((c) => c !== conflict);
      saveRepo(root, repo);
      console.log(`resolved '${name}' -> ${hash}`);
      return 0;
    }

    default:
      process.stdout.write(USAGE);
      return cmd ? 1 : 0;
  }
}

try {
  process.exit(main(process.argv.slice(2)));
} catch (e) {
  if (e instanceof CliError) {
    console.error(String(e.message));
    process.exit(1);
  }
  throw e;
}
