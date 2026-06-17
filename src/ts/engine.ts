import { extractDefs } from "./extract.ts";
import { assemble } from "./assemble.ts";
import { typecheckModule } from "./typecheck.ts";
import type { PendingTx, RepoState } from "./model.ts";

/** Raised when a submission would not type-check against the current namespace.
 *  Carries the compiler diagnostics so the agent sees exactly what is red. */
export class GreenGateError extends Error {
  constructor(public diagnostics: string[]) {
    super(`green-gate rejected submission:\n  ${diagnostics.join("\n  ")}`);
    this.name = "GreenGateError";
  }
}

/** Submit a TypeScript source as one agent's transaction. The definitions are
 *  extracted and content-addressed, then the whole would-be namespace is
 *  type-checked by the real compiler. Only if it is green is the transaction
 *  recorded as pending. Throws GreenGateError otherwise. */
export function submit(state: RepoState, by: string, intent: string, source: string): PendingTx {
  const defs = extractDefs(source);
  if (defs.length === 0) throw new Error("no top-level definitions found in submission");

  const binds = defs.map((d) => ({ name: d.name, hash: state.store.put(d) }));

  const candidate = new Map(state.namespace);
  for (const b of binds) candidate.set(b.name, { hash: b.hash, intent, by });

  const diagnostics = typecheckModule(assemble(candidate, state.store));
  if (diagnostics.length > 0) throw new GreenGateError(diagnostics);

  const tx: PendingTx = { by, intent, binds };
  state.pending.push(tx);
  return tx;
}
