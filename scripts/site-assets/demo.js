// The interactive proof: the swarm's own Sudoku solver (Strand transpiled to
// TypeScript, then to plain JS) running in the browser. Hand-written glue —
// everything it calls was authored by agents through the green-gate.
import { solve, Grid, Cons, Nil } from "./sudoku.js";

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

const mount = document.querySelector(".demo-mount");
if (mount) {
  const table = document.createElement("table");
  table.className = "sud";
  const cells = [];
  for (let r = 0; r < 9; r++) {
    const tr = document.createElement("tr");
    for (let c = 0; c < 9; c++) {
      const td = document.createElement("td");
      const v = PUZZLE[r * 9 + c];
      td.textContent = v === 0 ? "" : String(v);
      td.className = v === 0 ? "" : "given";
      cells.push(td);
      tr.appendChild(td);
    }
    table.appendChild(tr);
  }

  const btn = document.createElement("button");
  btn.className = "demo-btn";
  btn.textContent = "solve";
  btn.addEventListener("click", () => {
    const t0 = performance.now();
    const list = PUZZLE.reduceRight((acc, v) => Cons(v)(acc), Nil);
    const res = solve(Grid(list));
    if (res.tag !== "Some") {
      btn.textContent = "no solution";
      return;
    }
    const solved = [];
    for (let n = res.f0.f0; n.tag === "Cons"; n = n.f1) solved.push(n.f0);
    solved.forEach((v, i) => {
      if (PUZZLE[i] === 0) {
        cells[i].textContent = String(v);
        cells[i].className = "solved";
      }
    });
    btn.textContent = `solved in ${Math.round(performance.now() - t0)}ms`;
    btn.disabled = true;
  });

  mount.appendChild(table);
  mount.appendChild(btn);
}
