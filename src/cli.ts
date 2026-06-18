import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { StrandError } from "./errors.ts";
import { compileProgram, dataDeclsOf, evalQuery, registryOf, valueNamesOf } from "./pipeline.ts";
import { parseProgram } from "./syntax/parser.ts";
import { printProgram } from "./syntax/print.ts";
import { depsOf } from "./core/term.ts";
import { merge, resolveConflict } from "./merge.ts";
import { typecheckNamespace } from "./core/check.ts";
import { exportNamespace, namesOf, projectNamespace, renderDef } from "./project.ts";
import { emitModule } from "./backend/emit_ts.ts";
import { valueToString } from "./core/eval.ts";
import { initRepo, loadRepo, repoExists, saveRepo } from "./persist.ts";
import type { Hash } from "./core/term.ts";

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

function namespaceNames(ns: ReturnType<typeof loadRepo>["namespace"]): Map<string, Hash> {
  return new Map([...ns].map(([n, b]) => [n, b.hash]));
}

const USAGE = `strand — content-addressed substrate for parallel agent authoring

  strand init
  strand submit --as <author> --intent "<why>" (--file <f.strand> | --code "<src>")
  strand merge
  strand ls
  strand show <name>
  strand eval "<expr>"
  strand fmt <file.strand> [--write]   # pretty-print Strand source
  strand test                  # run all zero-arg Bool definitions as tests
  strand untested              # definitions not reached by any test
  strand require <name> <check...>     # set required checks for a definition
  strand attest <name> <check>         # record an attestation for its content hash
  strand verify                        # check all required checks are attested
  strand exec <name>           # run an IO action (interpreter)
  strand run <name>            # transpile to TS and execute
  strand emit [--out <file>]   # transpile namespace to TypeScript
  strand export [--out <file>] # write the namespace as Strand source (for git)
  strand pending
  strand conflicts
  strand resolve <name> <hash>
`;

function requireRepo(root: string): void {
  if (!repoExists(root)) {
    throw new StrandError("no .strand repo here — run `strand init` first");
  }
}

function main(argv: string[]): number {
  const { positionals, opts } = parseArgs(argv);
  const cmd = positionals[0];
  const root = process.env.STRAND_ROOT ?? process.cwd();

  switch (cmd) {
    case "init": {
      if (repoExists(root)) {
        console.log(".strand already exists");
        return 0;
      }
      initRepo(root);
      console.log("initialized empty Strand repo in .strand/");
      return 0;
    }

    case "submit": {
      requireRepo(root);
      const by = opts.as;
      if (!by) throw new StrandError("submit needs --as <author>");
      const intent = opts.intent ?? "";
      const src = opts.code ?? (opts.file ? readFileSync(opts.file, "utf8") : undefined);
      if (src === undefined) throw new StrandError("submit needs --file <path> or --code \"<src>\"");
      const repo = loadRepo(root);
      const binds = compileProgram(
        src,
        repo.store,
        valueNamesOf(repo.namespace, repo.store),
        dataDeclsOf(repo.namespace, repo.store),
      );
      repo.pending.push({ by, intent, binds: binds.map((b) => ({ name: b.name, hash: b.hash })) });
      saveRepo(root, repo);
      console.log(`submitted by ${by}: ${binds.map((b) => `${b.name}=${b.hash}`).join(", ")}`);
      return 0;
    }

    case "merge": {
      requireRepo(root);
      const repo = loadRepo(root);
      const result = merge(repo.namespace, repo.store, repo.pending);
      repo.namespace = result.namespace;
      repo.conflicts.push(...result.conflicts);
      repo.pending = [];
      saveRepo(root, repo);
      console.log(`applied  : ${result.applied.sort().join(", ") || "none"}`);
      console.log(`conflicts: ${result.conflicts.map((c) => c.name).join(", ") || "none"}`);
      console.log(`rejected : ${result.rejected.map((r) => `${r.name}(${r.reason})`).join(", ") || "none"}`);
      const red = typecheckNamespace(repo.namespace, repo.store);
      if (red.length > 0) {
        console.log(`green-gate: RED — ${red.map((r) => r.name).join(", ")}`);
        for (const r of red) console.log(`  ${r.name}: ${r.error}`);
      } else {
        console.log(`green-gate: green`);
        // a green namespace type-checks, so attest `typecheck` for every binding's hash
        for (const b of repo.namespace.values()) {
          const list = repo.attestations[b.hash] ?? [];
          if (!list.includes("typecheck")) list.push("typecheck");
          repo.attestations[b.hash] = list;
        }
        saveRepo(root, repo);
      }
      return result.conflicts.length > 0 || red.length > 0 ? 2 : 0;
    }

    case "ls": {
      requireRepo(root);
      const repo = loadRepo(root);
      console.log(projectNamespace(repo.namespace, repo.store, repo.conflicts));
      return 0;
    }

    case "show": {
      requireRepo(root);
      const name = positionals[1];
      if (!name) throw new StrandError("show needs a <name>");
      const repo = loadRepo(root);
      const b = repo.namespace.get(name);
      if (!b) throw new StrandError(`no such name '${name}'`);
      console.log(renderDef(name, b.hash, repo.store, namesOf(repo.namespace)));
      return 0;
    }

    case "fmt": {
      const file = positionals[1];
      if (!file) throw new StrandError("fmt needs a <file.strand>");
      const formatted = printProgram(parseProgram(readFileSync(file, "utf8")));
      if (opts.write) {
        writeFileSync(file, formatted);
        console.log(`formatted ${file}`);
      } else {
        process.stdout.write(formatted);
      }
      return 0;
    }

    case "eval": {
      requireRepo(root);
      const expr = positionals[1];
      if (!expr) throw new StrandError('eval needs an expression, e.g. eval "double 21"');
      const repo = loadRepo(root);
      console.log(
        valueToString(
          evalQuery(expr, repo.store, valueNamesOf(repo.namespace, repo.store), registryOf(repo.namespace, repo.store)),
        ),
      );
      return 0;
    }

    case "exec": {
      requireRepo(root);
      const name = positionals[1];
      if (!name) throw new StrandError("exec needs a <name : IO _>");
      const repo = loadRepo(root);
      const v = evalQuery(name, repo.store, valueNamesOf(repo.namespace, repo.store), registryOf(repo.namespace, repo.store));
      if (v.tag === "IO") v.run();
      else console.log(valueToString(v));
      return 0;
    }

    case "export": {
      requireRepo(root);
      const repo = loadRepo(root);
      const src = exportNamespace(repo.namespace, repo.store);
      if (opts.out) {
        writeFileSync(opts.out, src);
        console.log(`exported ${repo.namespace.size} definitions to ${opts.out}`);
      } else {
        process.stdout.write(src);
      }
      return 0;
    }

    case "emit": {
      requireRepo(root);
      const repo = loadRepo(root);
      const ts = emitModule(repo.namespace, repo.store);
      if (opts.out) {
        writeFileSync(opts.out, ts);
        console.log(`wrote ${opts.out}`);
      } else {
        process.stdout.write(ts);
      }
      return 0;
    }

    case "run": {
      requireRepo(root);
      const name = positionals[1];
      if (!name) throw new StrandError("run needs a <name>");
      const repo = loadRepo(root);
      if (!repo.namespace.has(name)) throw new StrandError(`no such name '${name}'`);
      const ts = emitModule(repo.namespace, repo.store) + `\nconsole.log(String(${name}));\n`;
      const file = join(root, ".strand", "_run.ts");
      writeFileSync(file, ts);
      const out = execFileSync("npx", ["tsx", file], { encoding: "utf8" });
      process.stdout.write(out);
      return 0;
    }

    case "pending": {
      requireRepo(root);
      const repo = loadRepo(root);
      if (repo.pending.length === 0) {
        console.log("no pending transactions");
        return 0;
      }
      for (const tx of repo.pending) {
        console.log(`${tx.by}: ${tx.binds.map((b) => b.name).join(", ")} — ${tx.intent}`);
      }
      return 0;
    }

    case "test": {
      requireRepo(root);
      const repo = loadRepo(root);
      const names = valueNamesOf(repo.namespace, repo.store);
      const registry = registryOf(repo.namespace, repo.store);
      // a test is a zero-parameter definition of type Bool
      const tests = [...repo.namespace].filter(([, b]) => {
        const def = repo.store.defOf(b.hash);
        const ty = repo.store.typeOf(b.hash);
        return def && def.params.length === 0 && ty?.tag === "Bool";
      });
      let pass = 0;
      let fail = 0;
      for (const [name] of tests.sort((a, z) => a[0].localeCompare(z[0]))) {
        const v = evalQuery(name, repo.store, names, registry);
        const ok = v.tag === "Bool" && v.value;
        console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
        ok ? pass++ : fail++;
      }
      console.log(`${pass} passed, ${fail} failed`);
      if (fail === 0 && tests.length > 0) {
        // all tests pass -> attest `tests` for the covered (dependency-closure) set
        const reachable = new Set<string>();
        const visit = (h: string): void => {
          if (reachable.has(h)) return;
          reachable.add(h);
          const def = repo.store.defOf(h);
          if (def) for (const d of depsOf(def.body)) visit(d);
        };
        for (const [, b] of tests) visit(b.hash);
        for (const h of reachable) {
          const list = repo.attestations[h] ?? [];
          if (!list.includes("tests")) list.push("tests");
          repo.attestations[h] = list;
        }
        saveRepo(root, repo);
      }
      return fail > 0 ? 1 : 0;
    }

    case "attest": {
      requireRepo(root);
      const name = positionals[1];
      const check = positionals[2];
      if (!name || !check) throw new StrandError("attest needs <name> <check>");
      const repo = loadRepo(root);
      const b = repo.namespace.get(name);
      if (!b) throw new StrandError(`no such name '${name}'`);
      const list = repo.attestations[b.hash] ?? [];
      if (!list.includes(check)) list.push(check);
      repo.attestations[b.hash] = list;
      saveRepo(root, repo);
      console.log(`attested '${check}' for ${name} (${b.hash})`);
      return 0;
    }

    case "require": {
      requireRepo(root);
      const name = positionals[1];
      const checks = positionals.slice(2);
      if (!name || checks.length === 0) throw new StrandError("require needs <name> <check...>");
      const repo = loadRepo(root);
      const b = repo.namespace.get(name);
      if (!b) throw new StrandError(`no such name '${name}'`);
      b.requires = checks;
      repo.namespace.set(name, b);
      saveRepo(root, repo);
      console.log(`${name} now requires: ${checks.join(", ")}`);
      return 0;
    }

    case "verify": {
      requireRepo(root);
      const repo = loadRepo(root);
      let allGreen = true;
      for (const [name, b] of [...repo.namespace].sort((a, z) => a[0].localeCompare(z[0]))) {
        const req = b.requires ?? [];
        if (req.length === 0) continue;
        const attested = new Set(repo.attestations[b.hash] ?? []);
        const missing = req.filter((c) => !attested.has(c));
        if (missing.length > 0) {
          allGreen = false;
          console.log(`RED   ${name}: missing ${missing.join(", ")}`);
        } else {
          console.log(`green ${name}`);
        }
      }
      console.log(allGreen ? "all required checks attested" : "some required checks are missing");
      return allGreen ? 0 : 2;
    }

    case "untested": {
      requireRepo(root);
      const repo = loadRepo(root);
      const valueDefs = [...repo.namespace].filter(([, b]) => repo.store.defOf(b.hash));
      const isTest = (h: Hash): boolean => {
        const def = repo.store.defOf(h);
        const ty = repo.store.typeOf(h);
        return !!def && def.params.length === 0 && ty?.tag === "Bool";
      };
      // covered = the transitive dependency closure of the test definitions
      const reachable = new Set<Hash>();
      const visit = (h: Hash): void => {
        if (reachable.has(h)) return;
        reachable.add(h);
        const def = repo.store.defOf(h);
        if (def) for (const d of depsOf(def.body)) visit(d);
      };
      for (const [, b] of valueDefs) if (isTest(b.hash)) visit(b.hash);
      const untested = valueDefs
        .filter(([, b]) => !reachable.has(b.hash) && !isTest(b.hash))
        .map(([n]) => n)
        .sort();
      if (untested.length === 0) console.log("all definitions are covered by a test");
      else console.log("untested:\n" + untested.map((n) => `  ${n}`).join("\n"));
      return 0;
    }

    case "conflicts": {
      requireRepo(root);
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
      requireRepo(root);
      const name = positionals[1];
      const hash = positionals[2];
      if (!name || !hash) throw new StrandError("resolve needs <name> <hash>");
      const repo = loadRepo(root);
      const conflict = repo.conflicts.find((c) => c.name === name);
      if (!conflict) throw new StrandError(`no parked conflict for '${name}'`);
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
  if (e instanceof StrandError) {
    console.error(String(e.message));
    process.exit(1);
  }
  throw e;
}
