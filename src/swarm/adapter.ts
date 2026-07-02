import { execFileSync } from "node:child_process";
import type { Note } from "../distributed/memory.ts";
import type { Task } from "./queue.ts";

/** The provider-agnostic agent layer. An "agent" is abstract: under it can be
 *  Claude, Codex, Gemini — whatever the operator picks. Strand does not care who
 *  authored a definition (it is content-addressed), so a provider is nothing more
 *  than a command plus a prompt template. Swapping providers never touches the
 *  worker loop. */

export interface AgentContext {
  task: Task;
  /** The current namespace as Strand source, so the agent builds on existing defs. */
  namespaceSource: string;
  /** The live decisions governing this task's targets (conventions, assumptions,
   *  spec notes) — read from the swarm's decision memory so agents don't diverge
   *  on choices that are not enforced by the types. */
  notes?: Note[];
  /** Why the previous attempt at this task failed (the green-gate's actual
   *  error), so a retry corrects the mistake instead of repeating it. */
  feedback?: string;
}

export interface AgentResult {
  /** Strand source to submit through the green-gate (definitions and/or tests). */
  code: string;
  /** A human-readable note carried back onto the task. */
  report: string;
}

export interface Agent {
  readonly provider: string;
  run(ctx: AgentContext): AgentResult;
}

/** Build the instruction handed to whichever provider runs. Deliberately provider-
 *  neutral: describe the job, show the existing namespace, demand a single Strand
 *  code block back. The green-gate — not the prompt — is what guarantees correctness. */
export function buildPrompt(ctx: AgentContext): string {
  const { task, namespaceSource, notes = [], feedback } = ctx;
  const job =
    task.role === "test"
      ? `Write Strand test definitions (zero-arg Bool defs) that exercise: ${task.target.join(", ")}.`
      : `Write the Strand definition(s) for: ${task.target.join(", ")}.`;
  const decisions =
    notes.length === 0
      ? []
      : [
          ``,
          `Decisions already made for this work — follow them, do not re-decide:`,
          ...notes.map((n) => `- [${n.type}] ${n.subject}: ${n.body}`),
        ];
  return [
    `You are authoring in Strand, a small typed functional language that transpiles to TypeScript.`,
    `Task: ${task.title}`,
    `Intent: ${task.intent}`,
    job,
    ...decisions,
    ``,
    `Strand syntax — the complete surface; use nothing beyond it:`,
    "```",
    `# a line comment`,
    `def name (p: Int) (q: Bool) -> Int = expr        # a definition (types required)`,
    `def tst_name -> Bool = expr                      # a test: zero params, returns Bool`,
    `data Shape a = Point | Circle a (List a)         # an algebraic data type`,
    `match xs { Nil -> 0 | Cons h t -> 1 + length t } # pattern match (constructors, literals, _)`,
    `if cond then a else b`,
    `f x y                                            # application by juxtaposition; partial application works`,
    "```",
    `Types: Int, Bool, Text, declared data types, functions (a -> b). Operators: + - * / == != < <= > >= && ||.`,
    `Literals: integers, "text", and lowercase true / false (NOT True/False). Text concat is ++.`,
    `Text builtins (total; out-of-range reads give ""): textLength : Text -> Int, charAt : Int -> Text -> Text,`,
    `substring : Int -> Int -> Text -> Text (start, end-exclusive), intToText : Int -> Text.`,
    `Recursion is allowed. There are no lambdas — name helper defs instead. No imports; only the namespace below.`,
    ...(feedback ? [``, `Your previous attempt was rejected by the type-checker. Fix exactly this:`, feedback] : []),
    ``,
    `The current namespace (build on these; reference them by name):`,
    "```strand",
    namespaceSource.trim() || "# (empty namespace)",
    "```",
    ``,
    `Reply with exactly one \`\`\`strand code block containing only the new definition(s).`,
    `No prose outside the code block. It must type-check on its own against the namespace above.`,
    `If the task is ambiguous, do not ask — pick the most reasonable interpretation and record it`,
    `inside the code block as a comment line: # assume: <what you assumed and why>`,
  ].join("\n");
}

/** Pull the Strand source out of a model reply: the first fenced ```strand block,
 *  falling back to any fenced block, falling back to the whole reply. */
export function extractStrand(reply: string): string {
  const fenced = reply.match(/```(?:strand)?\s*\n([\s\S]*?)```/);
  return (fenced ? fenced[1] : reply).trim();
}

/** A provider is a subprocess: a command whose args carry the prompt (via the
 *  `{prompt}` placeholder) or, if no placeholder is present, receive it on stdin. */
export interface CliProvider {
  provider: string;
  command: string;
  args: string[];
  /** Kill the subprocess after this long — a hung model call must not wedge a
   *  worker forever. */
  timeoutMs?: number;
}

/** How a provider call failed, so the worker can react differently:
 *  - timeout: the subprocess was killed after timeoutMs — park path, distinct outcome
 *  - transient: rate limit / 5xx / network — retry with backoff, no attempt burned
 *  - permanent: auth failure / missing binary — stop the worker with a clear message */
export type ProviderFailureKind = "timeout" | "transient" | "permanent";

export class ProviderError extends Error {
  constructor(
    readonly kind: ProviderFailureKind,
    message: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

/** Best-effort presets. Flags are the seam we expect to adjust per environment;
 *  the interface is what stays fixed. */
export const PROVIDERS: Record<string, CliProvider> = {
  claude: { provider: "claude", command: "claude", args: ["-p", "{prompt}"], timeoutMs: 600_000 },
  codex: { provider: "codex", command: "codex", args: ["exec", "{prompt}"], timeoutMs: 600_000 },
  gemini: { provider: "gemini", command: "gemini", args: ["-p", "{prompt}"], timeoutMs: 600_000 },
};

const TRANSIENT_RE = /rate.?limit|too many requests|429|overloaded|50[023-4]|internal server error|service unavailable|temporar|try again|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|EAI_AGAIN|socket hang up/i;
const PERMANENT_RE = /unauthorized|forbidden|401|403|invalid.{0,20}(api.?key|token|credential)|api.?key.{0,20}(invalid|missing|not set)|not logged in|please (log|sign) ?in|authentication/i;

/** Map a subprocess failure to a ProviderError. Exported for tests. */
export function classifyExecError(e: unknown, provider: string, timeoutMs: number): ProviderError {
  const err = e as Error & { code?: string; signal?: string; killed?: boolean; stderr?: string; stdout?: string };
  if (err.code === "ETIMEDOUT" || (err.killed && (err.signal === "SIGTERM" || err.signal === "SIGKILL"))) {
    return new ProviderError("timeout", `provider timeout: ${provider} produced nothing within ${timeoutMs}ms`);
  }
  if (err.code === "ENOENT") {
    return new ProviderError("permanent", `provider binary not found: '${provider}' — is it installed and on PATH?`);
  }
  const detail = [err.stderr, err.stdout, err.message].filter(Boolean).join("\n");
  const firstLine = (err.stderr?.trim() || err.message).split("\n")[0];
  if (PERMANENT_RE.test(detail)) return new ProviderError("permanent", `provider auth failure (${provider}): ${firstLine}`);
  if (TRANSIENT_RE.test(detail)) return new ProviderError("transient", `provider transient failure (${provider}): ${firstLine}`);
  // Unknown exec errors are treated as transient: the model never replied, so
  // there is no output to judge and a retry is the only move that can learn more.
  return new ProviderError("transient", `provider failure (${provider}): ${firstLine}`);
}

export class CliAgent implements Agent {
  readonly provider: string;
  constructor(private readonly spec: CliProvider) {
    this.provider = spec.provider;
  }

  run(ctx: AgentContext): AgentResult {
    const prompt = buildPrompt(ctx);
    const usesPlaceholder = this.spec.args.some((a) => a.includes("{prompt}"));
    const args = this.spec.args.map((a) => a.replace("{prompt}", prompt));
    const timeoutMs = this.spec.timeoutMs ?? 600_000;
    let reply: string;
    try {
      reply = execFileSync(this.spec.command, args, {
        input: usesPlaceholder ? undefined : prompt,
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
        timeout: timeoutMs,
        killSignal: "SIGKILL",
      });
    } catch (e) {
      throw classifyExecError(e, this.provider, timeoutMs);
    }
    return { code: extractStrand(reply), report: `authored by ${this.provider}` };
  }
}

/** Resolve a provider name to an agent. Unknown names are an explicit error so a
 *  typo never silently falls back to the wrong model. */
export function agentFor(provider: string): Agent {
  const spec = PROVIDERS[provider];
  if (!spec) throw new Error(`unknown provider '${provider}' (have: ${Object.keys(PROVIDERS).join(", ")})`);
  return new CliAgent(spec);
}
