import { execFileSync } from "node:child_process";
import { PROVIDERS, classifyExecError, type CliProvider } from "./adapter.ts";
import { partition } from "./partition.ts";
import type { DefSpec } from "./plan.ts";

/** The planner as an agent (#39) — the one genuinely agentic role: goal in,
 *  DefSpec[] out (names, intents, deps, pinned specs), validated before a
 *  single task is seeded and reported (width / critical path) before any
 *  model spend is committed to workers. */

export function buildPlanPrompt(goal: string): string {
  return [
    `You are the planner for a swarm of AI agents authoring in Strand, a small typed`,
    `functional language (Int, Bool, Text, algebraic data types, recursion, no lambdas).`,
    `Decompose the goal below into small, independently testable definitions.`,
    ``,
    `Goal: ${goal}`,
    ``,
    `Reply with exactly one \`\`\`json code block: an array of objects, each`,
    `{ "name": "<defName>", "intent": "<one line: what it does>",`,
    `  "deps": ["<names of earlier entries it references>"],`,
    `  "spec": "<optional pinned contract: signature + behavior>" }`,
    ``,
    `Rules:`,
    `- names are valid identifiers (letter first, then letters/digits/underscore), unique`,
    `- deps may only reference names defined by other entries in the array; no cycles`,
    `- prefer a wide graph: many small independent defs beat one deep chain`,
    `- 5 to 40 entries; every non-trivial def gets a spec so agents share one contract`,
    `No prose outside the code block.`,
  ].join("\n");
}

/** Pull the JSON out of a model reply: the first fenced block, else the reply. */
export function extractPlanJson(reply: string): string {
  const fenced = reply.match(/```(?:json)?\s*\n([\s\S]*?)```/);
  return (fenced ? fenced[1] : reply).trim();
}

const NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

/** Validate a model-produced plan and return it in dependency order. Throws
 *  with an actionable message on duplicate/invalid names, unknown deps or
 *  cycles — a broken plan must die here, not as parked tasks mid-run. */
export function validatePlan(raw: unknown): DefSpec[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new Error("plan is not a non-empty array");
  const specs = raw.map((r, i) => {
    const o = r as Partial<DefSpec>;
    if (typeof o.name !== "string" || !NAME_RE.test(o.name)) throw new Error(`entry ${i}: bad name '${String(o.name)}'`);
    if (typeof o.intent !== "string" || !o.intent.trim()) throw new Error(`'${o.name}': missing intent`);
    const deps = o.deps ?? [];
    if (!Array.isArray(deps) || deps.some((d) => typeof d !== "string")) throw new Error(`'${o.name}': deps must be a string array`);
    if (o.spec !== undefined && typeof o.spec !== "string") throw new Error(`'${o.name}': spec must be a string`);
    return { name: o.name, intent: o.intent.trim(), deps, spec: o.spec, test: o.test, helperPrefix: o.name } satisfies DefSpec;
  });

  const byName = new Map(specs.map((s) => [s.name, s]));
  if (byName.size !== specs.length) {
    const seen = new Set<string>();
    const dup = specs.find((s) => (seen.has(s.name) ? true : (seen.add(s.name), false)))!;
    throw new Error(`duplicate name '${dup.name}'`);
  }
  for (const s of specs) {
    for (const d of s.deps) {
      if (!byName.has(d)) throw new Error(`'${s.name}' depends on '${d}', which the plan never defines`);
      if (d === s.name) throw new Error(`'${s.name}' depends on itself`);
    }
  }

  // topological order (so seedTasks' defined-earlier rule holds); cycle = error
  const ordered: DefSpec[] = [];
  const state = new Map<string, "visiting" | "done">();
  const visit = (name: string, trail: string[]): void => {
    const st = state.get(name);
    if (st === "done") return;
    if (st === "visiting") throw new Error(`cycle: ${[...trail, name].join(" -> ")}`);
    state.set(name, "visiting");
    for (const d of byName.get(name)!.deps) visit(d, [...trail, name]);
    state.set(name, "done");
    ordered.push(byName.get(name)!);
  };
  for (const s of specs) visit(s.name, []);
  return ordered;
}

export interface PlanShape {
  defs: number;
  /** Longest dependency chain — the serial floor of the run. */
  criticalPath: number;
  /** Widest layer — how many workers can be busy at once. */
  width: number;
  /** Most-depended-on names (the partitioner's fan-in centrality). */
  hot: { name: string; fanIn: number }[];
}

/** Report the graph's shape before committing model spend: layers by depth
 *  give width and critical path; `strand partition`'s centrality names the
 *  hot nodes the hint layer will watch. */
export function planShape(specs: DefSpec[]): PlanShape {
  const depth = new Map<string, number>();
  const d = (name: string): number => {
    if (depth.has(name)) return depth.get(name)!;
    const s = specs.find((x) => x.name === name)!;
    const v = s.deps.length === 0 ? 0 : 1 + Math.max(...s.deps.map(d));
    depth.set(name, v);
    return v;
  };
  specs.forEach((s) => d(s.name));
  const layers = new Map<number, number>();
  for (const v of depth.values()) layers.set(v, (layers.get(v) ?? 0) + 1);
  const { centrality } = partition(
    specs.map((s) => ({ id: s.name, label: s.name, deps: s.deps })),
    2,
  );
  return {
    defs: specs.length,
    criticalPath: Math.max(...depth.values()) + 1,
    width: Math.max(...layers.values()),
    hot: centrality.filter((c) => c.fanIn > 0).slice(0, 5).map((c) => ({ name: c.label, fanIn: c.fanIn })),
  };
}

/** Run a provider CLI once with the planning prompt. Separated so tests can
 *  inject a fake runner. */
export function runProvider(spec: CliProvider, prompt: string): string {
  const usesPlaceholder = spec.args.some((a) => a.includes("{prompt}"));
  const args = spec.args.map((a) => a.replace("{prompt}", prompt));
  const timeoutMs = spec.timeoutMs ?? 600_000;
  try {
    return execFileSync(spec.command, args, {
      input: usesPlaceholder ? undefined : prompt,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      timeout: timeoutMs,
      killSignal: "SIGKILL",
    });
  } catch (e) {
    throw classifyExecError(e, spec.provider, timeoutMs);
  }
}

/** Goal -> validated, dependency-ordered DefSpec[] plus its shape. */
export function planGoal(
  goal: string,
  provider: string,
  run: (spec: CliProvider, prompt: string) => string = runProvider,
): { specs: DefSpec[]; shape: PlanShape } {
  const spec = PROVIDERS[provider];
  if (!spec) throw new Error(`unknown provider '${provider}' (have: ${Object.keys(PROVIDERS).join(", ")})`);
  const reply = run(spec, buildPlanPrompt(goal));
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractPlanJson(reply));
  } catch {
    throw new Error(`the planner reply is not JSON:\n${reply.slice(0, 400)}`);
  }
  const specs = validatePlan(parsed);
  return { specs, shape: planShape(specs) };
}
