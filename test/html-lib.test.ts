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

// #47: the typed Html stdlib goes through the real green-gate and its own
// tst_ defs run under strand test — markup safety enforced by types, not lint.
test("lib/html.strand lands green and all its tests pass", () => {
  const dir = mkdtempSync(join(tmpdir(), "strand-html-"));
  cli(dir, ["init"]);
  const prelude = readFileSync(join(process.cwd(), "lib", "prelude.strand"), "utf8");
  const html = readFileSync(join(process.cwd(), "lib", "html.strand"), "utf8");
  cli(dir, ["submit", "--as", "stdlib", "--intent", "prelude", "--code", prelude]);
  cli(dir, ["merge"]);
  cli(dir, ["submit", "--as", "stdlib", "--intent", "typed html (#47)", "--code", html]);
  const merged = cli(dir, ["merge"]);
  assert.match(merged, /green-gate: green/);

  const out = cli(dir, ["test"]);
  assert.match(out, /0 failed/);
  assert.match(out, /ok +tst_renderTxtEscapes/);

  // interpreter spot checks
  assert.equal(cli(dir, ["eval", 'escapeHtml "<&>"']).trim(), '"&lt;&amp;&gt;"');
  assert.equal(cli(dir, ["eval", 'render (Txt "<b>")']).trim(), '"&lt;b&gt;"');
});
