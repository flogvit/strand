import ts from "typescript";

const FILE = "strand-module.ts";

const OPTIONS: ts.CompilerOptions = {
  strict: true,
  noEmit: true,
  target: ts.ScriptTarget.ES2022,
  moduleDetection: ts.ModuleDetectionKind.Force,
  skipLibCheck: true,
  types: [],
};

/** Type-check an assembled module with the real TypeScript compiler. Returns
 *  the diagnostics as readable strings (empty array == green). This is Strand's
 *  green-gate on real code: the actual `tsc`, not a toy checker. */
export function typecheckModule(source: string): string[] {
  const host = ts.createCompilerHost(OPTIONS, true);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (name, languageVersion, onError, shouldCreate) =>
    name === FILE
      ? ts.createSourceFile(name, source, languageVersion, true)
      : getSourceFile(name, languageVersion, onError, shouldCreate);
  const readFile = host.readFile.bind(host);
  host.readFile = (name) => (name === FILE ? source : readFile(name));
  const fileExists = host.fileExists.bind(host);
  host.fileExists = (name) => name === FILE || fileExists(name);

  const program = ts.createProgram([FILE], OPTIONS, host);
  return ts
    .getPreEmitDiagnostics(program)
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
}
