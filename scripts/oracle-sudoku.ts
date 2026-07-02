import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Independent oracle + differential test for the swarm-built solver.
 *
 *  Feeds a known external puzzle (Wikipedia's classic Sudoku) to the solver
 *  through BOTH execution engines — the reference interpreter (`strand eval`)
 *  and the transpiled TypeScript (`strand emit` + tsx) — and verifies each
 *  answer with a checker that shares NO code with the swarm's definitions:
 *  every row/column/box a permutation of 1..9, every clue preserved. Finally
 *  the two engines must agree cell for cell, so one run validates the solver
 *  AND that interpreter and transpiler are semantically in agreement.
 *
 *    STRAND_ROOT=<swarm root> npx tsx scripts/oracle-sudoku.ts
 */

const root = process.env.STRAND_ROOT;
if (!root) throw new Error("set STRAND_ROOT to the swarm-built repo");
const CLI = join(process.cwd(), "src", "cli.ts");

// Wikipedia's canonical puzzle (unique solution), row-major, 0 = empty.
const PUZZLE = [
  5, 3, 0, 0, 7, 0, 0, 0, 0,
  6, 0, 0, 1, 9, 5, 0, 0, 0,
  0, 9, 8, 0, 0, 0, 0, 6, 0,
  8, 0, 0, 0, 6, 0, 0, 0, 3,
  4, 0, 0, 8, 0, 3, 0, 0, 1,
  7, 0, 0, 0, 2, 0, 0, 0, 6,
  0, 6, 0, 0, 0, 0, 2, 8, 0,
  0, 0, 0, 4, 1, 9, 0, 0, 5,
  0, 0, 0, 0, 8, 0, 0, 7, 9,
];

function strand(args: string[]): string {
  return execFileSync("npx", ["tsx", CLI, ...args], {
    env: { ...process.env, STRAND_ROOT: root },
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
}

/** The independent checker — plain TypeScript, zero swarm code. */
function check(label: string, solved: number[]): void {
  if (solved.length !== 81) throw new Error(`${label}: expected 81 cells, got ${solved.length}`);
  const isPerm = (xs: number[]): boolean => [...xs].sort((a, b) => a - b).join() === "1,2,3,4,5,6,7,8,9";
  const row = (r: number) => solved.slice(r * 9, r * 9 + 9);
  const col = (c: number) => Array.from({ length: 9 }, (_, r) => solved[r * 9 + c]);
  const box = (b: number) =>
    Array.from({ length: 9 }, (_, i) => solved[(Math.floor(b / 3) * 3 + Math.floor(i / 3)) * 9 + (b % 3) * 3 + (i % 3)]);

  const failures: string[] = [];
  for (let i = 0; i < 9; i++) {
    if (!isPerm(row(i))) failures.push(`row ${i} is not a permutation of 1..9: ${row(i).join(" ")}`);
    if (!isPerm(col(i))) failures.push(`col ${i} is not a permutation of 1..9`);
    if (!isPerm(box(i))) failures.push(`box ${i} is not a permutation of 1..9`);
  }
  PUZZLE.forEach((clue, i) => {
    if (clue !== 0 && solved[i] !== clue) failures.push(`clue at cell ${i} changed: ${clue} -> ${solved[i]}`);
  });
  if (failures.length > 0) throw new Error(`${label} FAILED:\n${failures.join("\n")}`);
  console.log(`${label}: rule-valid solution, all 30 clues preserved ✓`);
}

// ---- engine 1: the reference interpreter -----------------------------------
const strandList = PUZZLE.reduceRight((acc, v) => `(Cons ${v} ${acc})`, "Nil");
console.log("engine 1 — interpreter (strand eval)...");
const interpOut = strand(["eval", `solve (Grid ${strandList})`]);
if (!interpOut.includes("Some")) throw new Error(`interpreter returned no solution: ${interpOut.trim().slice(0, 120)}`);
const interpSolved = [...interpOut.matchAll(/-?\d+/g)].map((m) => Number(m[0]));
check("interpreter", interpSolved);

// ---- engine 2: the transpiled TypeScript -----------------------------------
console.log("engine 2 — transpiled TS (strand emit + tsx)...");
const dir = mkdtempSync(join(tmpdir(), "strand-oracle-"));
const emitted = join(dir, "namespace.ts");
strand(["emit", "--out", emitted]);
// Zero-arg defs emit as eager consts, so importing the projection would run
// all 150+ model-written tst_ tests (hours of generate/dig searches) before
// solve is ever called. Tests are leaves — nothing depends on them — so
// stripping them is safe for driving the solver.
writeFileSync(
  emitted,
  readFileSync(emitted, "utf8")
    .split("\n")
    .filter((l) => !l.startsWith("export const tst_"))
    .join("\n"),
);

const driver = join(dir, "driver.ts");
writeFileSync(
  driver,
  [
    `import { solve, Grid, Cons, Nil } from "./namespace.ts";`,
    `const puzzle = ${JSON.stringify(PUZZLE)};`,
    `const list = puzzle.reduceRight((acc, v) => Cons(v)(acc), Nil as any);`,
    `const res = solve(Grid(list)) as any;`,
    `if (res.tag !== "Some") { console.log("NONE"); process.exit(1); }`,
    `const out: number[] = [];`,
    `for (let n = res.f0.f0; n.tag === "Cons"; n = n.f1) out.push(n.f0);`,
    `console.log(out.join(" "));`,
  ].join("\n"),
);
const tsOut = execFileSync("npx", ["tsx", driver], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
if (tsOut.includes("NONE")) throw new Error("transpiled solver returned no solution");
const tsSolved = tsOut.trim().split(/\s+/).map(Number);
check("transpiled TS", tsSolved);

// ---- differential: the two engines must agree ------------------------------
const diff = interpSolved.map((v, i) => (v !== tsSolved[i] ? i : -1)).filter((i) => i >= 0);
if (diff.length > 0) throw new Error(`engines disagree at cells: ${diff.join(", ")}`);

for (let r = 0; r < 9; r++) console.log(interpSolved.slice(r * 9, r * 9 + 9).join(" "));
console.log("\nOK: both engines solved it, independently verified, and agree cell for cell.");
