import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(process.cwd(), "src", "cli.ts");

function cli(dir: string, args: string[]): string {
  return execFileSync("npx", ["tsx", CLI, ...args], { env: { ...process.env, STRAND_ROOT: dir }, encoding: "utf8" });
}

// #48: typed Css — tokens and component-scoped styles through the gate.
test("lib/css.strand lands green, tokens resolve by name, tests pass", () => {
  const dir = mkdtempSync(join(tmpdir(), "strand-css-"));
  cli(dir, ["init"]);
  const prelude = readFileSync(join(process.cwd(), "lib", "prelude.strand"), "utf8");
  const css = readFileSync(join(process.cwd(), "lib", "css.strand"), "utf8");
  cli(dir, ["submit", "--as", "stdlib", "--intent", "prelude", "--code", prelude]);
  cli(dir, ["merge"]);
  cli(dir, ["submit", "--as", "stdlib", "--intent", "typed css (#48)", "--code", css]);
  const merged = cli(dir, ["merge"]);
  assert.match(merged, /green-gate: green/);

  const out = cli(dir, ["test"]);
  assert.match(out, /0 failed/);
  assert.match(out, /ok +tst_renderCssConcat/);

  // a token typo is a type error, not a review comment: colorAccnet is unbound
  try {
    cli(dir, ["submit", "--as", "x", "--intent", "bad", "--code",
      'def badStyles -> List Rule = Cons (Rule "a" (Cons (Decl "color" colorAccnet) Nil)) Nil']);
    assert.fail("unbound token should be rejected");
  } catch (e) {
    assert.match(String((e as { stderr?: string }).stderr ?? e), /colorAccnet/);
  }
});
