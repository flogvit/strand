import { execFileSync } from "node:child_process";
import { join } from "node:path";

/** Independent oracle for the swarm-built solver: feed it a known external
 *  puzzle (Wikipedia's classic Sudoku) and verify the answer with a checker
 *  that shares NO code with the swarm's own definitions — rows, columns and
 *  boxes must each be a permutation of 1..9 and every clue must be preserved.
 *  Self-consistency (isUnique(generate n)=true) cannot catch a conspiring pair
 *  of bugs in generator and judge; an external ground truth can.
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

const strandList = PUZZLE.reduceRight((acc, v) => `(Cons ${v} ${acc})`, "Nil");
const expr = `solve (Grid ${strandList})`;

console.log("solving Wikipedia's puzzle with the swarm-built solver...");
const out = execFileSync("npx", ["tsx", CLI, "eval", expr], {
  env: { ...process.env, STRAND_ROOT: root },
  encoding: "utf8",
  maxBuffer: 32 * 1024 * 1024,
});

if (!out.includes("Some")) {
  console.log(`FAIL: solver returned no solution: ${out.trim().slice(0, 120)}`);
  process.exit(1);
}
const solved = [...out.matchAll(/-?\d+/g)].map((m) => Number(m[0]));
if (solved.length !== 81) {
  console.log(`FAIL: expected 81 cells, parsed ${solved.length}`);
  process.exit(1);
}

// The independent checker — plain TypeScript, zero swarm code.
const isPerm1to9 = (xs: number[]): boolean => [...xs].sort((a, b) => a - b).join() === "1,2,3,4,5,6,7,8,9";
const row = (r: number) => solved.slice(r * 9, r * 9 + 9);
const col = (c: number) => Array.from({ length: 9 }, (_, r) => solved[r * 9 + c]);
const box = (b: number) =>
  Array.from({ length: 9 }, (_, i) => solved[(Math.floor(b / 3) * 3 + Math.floor(i / 3)) * 9 + (b % 3) * 3 + (i % 3)]);

const failures: string[] = [];
for (let i = 0; i < 9; i++) {
  if (!isPerm1to9(row(i))) failures.push(`row ${i} is not a permutation of 1..9: ${row(i).join(" ")}`);
  if (!isPerm1to9(col(i))) failures.push(`col ${i} is not a permutation of 1..9`);
  if (!isPerm1to9(box(i))) failures.push(`box ${i} is not a permutation of 1..9`);
}
PUZZLE.forEach((clue, i) => {
  if (clue !== 0 && solved[i] !== clue) failures.push(`clue at cell ${i} changed: ${clue} -> ${solved[i]}`);
});

for (let r = 0; r < 9; r++) console.log(row(r).join(" "));
if (failures.length > 0) {
  console.log(`\nFAIL:\n${failures.join("\n")}`);
  process.exit(1);
}
console.log("\nOK: a complete, rule-valid solution preserving all 30 clues — independently verified.");
