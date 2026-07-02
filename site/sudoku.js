export const Nil = { tag: "Nil" };
export const Cons = (f0) => (f1) => ({ tag: "Cons", f0, f1 });
export const None = { tag: "None" };
export const Some = (f0) => ({ tag: "Some", f0 });
export const Pair = (f0) => (f1) => ({ tag: "Pair", f0, f1 });
export const Grid = (f0) => ({ tag: "Grid", f0 });
export const add = (a) => (b) => (a + b);
export const length = (xs) => (() => { const $s0 = xs; if ($s0.tag === "Nil") {
    return 0;
} if ($s0.tag === "Cons") {
    const h = $s0.f0;
    const t = $s0.f1;
    return (1 + length(t));
} throw new Error("non-exhaustive match"); })();
export const append = (xs) => (ys) => (() => { const $s1 = xs; if ($s1.tag === "Nil") {
    return ys;
} if ($s1.tag === "Cons") {
    const h = $s1.f0;
    const t = $s1.f1;
    return Cons(h)(append(t)(ys));
} throw new Error("non-exhaustive match"); })();
export const map = (f) => (xs) => (() => { const $s2 = xs; if ($s2.tag === "Nil") {
    return Nil;
} if ($s2.tag === "Cons") {
    const h = $s2.f0;
    const t = $s2.f1;
    return Cons(f(h))(map(f)(t));
} throw new Error("non-exhaustive match"); })();
export const filter = (p) => (xs) => (() => { const $s3 = xs; if ($s3.tag === "Nil") {
    return Nil;
} if ($s3.tag === "Cons") {
    const h = $s3.f0;
    const t = $s3.f1;
    return (p(h) ? Cons(h)(filter(p)(t)) : filter(p)(t));
} throw new Error("non-exhaustive match"); })();
export const foldr = (f) => (z) => (xs) => (() => { const $s4 = xs; if ($s4.tag === "Nil") {
    return z;
} if ($s4.tag === "Cons") {
    const h = $s4.f0;
    const t = $s4.f1;
    return f(h)(foldr(f)(z)(t));
} throw new Error("non-exhaustive match"); })();
export const sum = (xs) => foldr(add)(0)(xs);
export const range = (n) => ((n < 1) ? Nil : append(range((n - 1)))(Cons(n)(Nil)));
export const gridIndex = (row) => (col) => ((row * 9) + col);
export const inBounds = (row) => (col) => ((((row >= 0) && (row < 9)) && (col >= 0)) && (col < 9));
export const nth = (i) => (xs) => (() => { const $s5 = xs; if ($s5.tag === "Nil") {
    return None;
} if ($s5.tag === "Cons") {
    const h = $s5.f0;
    const t = $s5.f1;
    return ((i === 0) ? Some(h) : nth((i - 1))(t));
} throw new Error("non-exhaustive match"); })();
export const setNth = (i) => (v) => (xs) => (() => { const $s6 = xs; if ($s6.tag === "Nil") {
    return Nil;
} if ($s6.tag === "Cons") {
    const h = $s6.f0;
    const t = $s6.f1;
    return ((i === 0) ? Cons(v)(t) : Cons(h)(setNth((i - 1))(v)(t)));
} throw new Error("non-exhaustive match"); })();
export const replicate = (n) => (v) => ((n < 1) ? Nil : Cons(v)(replicate((n - 1))(v)));
export const emptyGrid = Grid(replicate(81)(0));
export const cells = (g) => (() => { const $s7 = g; if ($s7.tag === "Grid") {
    const xs = $s7.f0;
    return xs;
} throw new Error("non-exhaustive match"); })();
export const getCell = (g) => (row) => (col) => (inBounds(row)(col) ? nth(gridIndex(row)(col))(cells(g)) : None);
export const setCell = (g) => (row) => (col) => (v) => (inBounds(row)(col) ? Grid(setNth(gridIndex(row)(col))(v)(cells(g))) : g);
export const cellIs = (g) => (row) => (col) => (v) => (() => { const $s12 = getCell(g)(row)(col); if ($s12.tag === "Some") {
    const x = $s12.f0;
    return (x === v);
} if ($s12.tag === "None") {
    return false;
} throw new Error("non-exhaustive match"); })();
export const rowHasFrom = (g) => (row) => (col) => (v) => ((col >= 9) ? false : (cellIs(g)(row)(col)(v) ? true : rowHasFrom(g)(row)((col + 1))(v)));
export const rowOk = (g) => (row) => (v) => ((v === 0) ? true : (rowHasFrom(g)(row)(0)(v) ? false : true));
export const colHasFrom = (g) => (row) => (col) => (v) => ((row >= 9) ? false : (cellIs(g)(row)(col)(v) ? true : colHasFrom(g)((row + 1))(col)(v)));
export const colOk = (g) => (col) => (v) => ((v === 0) ? true : (colHasFrom(g)(0)(col)(v) ? false : true));
export const boxStart = (i) => (Math.trunc(i / 3) * 3);
export const boxHasFrom = (g) => (row) => (col) => (rowEnd) => (colStart) => (colEnd) => (v) => ((row >= rowEnd) ? false : ((col >= colEnd) ? boxHasFrom(g)((row + 1))(colStart)(rowEnd)(colStart)(colEnd)(v) : (cellIs(g)(row)(col)(v) ? true : boxHasFrom(g)(row)((col + 1))(rowEnd)(colStart)(colEnd)(v))));
export const boxOk = (g) => (row) => (col) => (v) => ((v === 0) ? true : (boxHasFrom(g)(boxStart(row))(boxStart(col))((boxStart(row) + 3))(boxStart(col))((boxStart(col) + 3))(v) ? false : true));
export const valid = (g) => (row) => (col) => (v) => (((inBounds(row)(col) && rowOk(g)(row)(v)) && colOk(g)(col)(v)) && boxOk(g)(row)(col)(v));
export const solveCell = (g) => (row) => (col) => ((row >= 9) ? Some(g) : ((col >= 9) ? solveCell(g)((row + 1))(0) : (cellIs(g)(row)(col)(0) ? tryValues(g)(row)(col)(1) : solveCell(g)(row)((col + 1)))));
export const tryValues = (g) => (row) => (col) => (v) => ((v > 9) ? None : (valid(g)(row)(col)(v) ? (() => { const $s13 = solveCell(setCell(g)(row)(col)(v))(row)((col + 1)); if ($s13.tag === "Some") {
    const s = $s13.f0;
    return Some(s);
} if ($s13.tag === "None") {
    return tryValues(g)(row)(col)((v + 1));
} throw new Error("non-exhaustive match"); })() : tryValues(g)(row)(col)((v + 1))));
export const solve = (g) => solveCell(g)(0)(0);
export const noZeros = (xs) => (() => { const $s14 = xs; if ($s14.tag === "Nil") {
    return true;
} if ($s14.tag === "Cons") {
    const h = $s14.f0;
    const t = $s14.f1;
    return ((h === 0) ? false : noZeros(t));
} throw new Error("non-exhaustive match"); })();
export const countAdd = (n) => (g) => (row) => (col) => (v) => (limit) => ((n >= limit) ? n : (n + countValuesUpTo(g)(row)(col)((v + 1))((limit - n))));
export const countCellFrom = (g) => (row) => (col) => (limit) => ((row >= 9) ? 1 : ((col >= 9) ? countCellFrom(g)((row + 1))(0)(limit) : (cellIs(g)(row)(col)(0) ? countValuesUpTo(g)(row)(col)(1)(limit) : countCellFrom(g)(row)((col + 1))(limit))));
export const countValuesUpTo = (g) => (row) => (col) => (v) => (limit) => ((v > 9) ? 0 : (valid(g)(row)(col)(v) ? countAdd(countCellFrom(setCell(g)(row)(col)(v))(row)((col + 1))(limit))(g)(row)(col)(v)(limit) : countValuesUpTo(g)(row)(col)((v + 1))(limit)));
export const countSolutions = (g) => (limit) => ((limit < 1) ? 0 : countCellFrom(g)(0)(0)(limit));
export const isUnique = (g) => (countSolutions(g)(2) === 1);
export const fullBoard = (() => { const $s19 = solve(emptyGrid); if ($s19.tag === "Some") {
    const s = $s19.f0;
    return s;
} if ($s19.tag === "None") {
    return emptyGrid;
} throw new Error("non-exhaustive match"); })();
export const digTarget = (difficulty) => ((difficulty <= 1) ? 30 : ((difficulty === 2) ? 40 : 50));
export const wrap81 = (i) => ((i >= 81) ? (i - 81) : i);
export const digFrom = (g) => (idx) => (steps) => (remaining) => ((remaining < 1) ? g : ((steps >= 81) ? g : digTryCell(g)(idx)(steps)(remaining)));
export const digKeepOrSkip = (g) => (dug) => (idx) => (steps) => (remaining) => (isUnique(dug) ? digFrom(dug)(wrap81((idx + 53)))((steps + 1))((remaining - 1)) : digFrom(g)(wrap81((idx + 53)))((steps + 1))(remaining));
export const digTryCell = (g) => (idx) => (steps) => (remaining) => (() => { const $s20 = getCell(g)(Math.trunc(idx / 9))((idx - (Math.trunc(idx / 9) * 9))); if ($s20.tag === "Some") {
    const v = $s20.f0;
    return ((v === 0) ? digFrom(g)(wrap81((idx + 53)))((steps + 1))(remaining) : digKeepOrSkip(g)(setCell(g)(Math.trunc(idx / 9))((idx - (Math.trunc(idx / 9) * 9)))(0))(idx)(steps)(remaining));
} if ($s20.tag === "None") {
    return g;
} throw new Error("non-exhaustive match"); })();
export const dig = (g) => (difficulty) => digFrom(g)(0)(0)(digTarget(difficulty));
export const isZero = (v) => (v === 0);
export const countZeros = (g) => length(filter(isZero)(cells(g)));
export const generate = (difficulty) => dig(fullBoard)(difficulty);
export const listEqInt = (xs) => (ys) => (() => { const $s27 = xs; if ($s27.tag === "Nil") {
    return (() => { const $s28 = ys; if ($s28.tag === "Nil") {
        return true;
    } if ($s28.tag === "Cons") {
        const h2 = $s28.f0;
        const t2 = $s28.f1;
        return false;
    } throw new Error("non-exhaustive match"); })();
} if ($s27.tag === "Cons") {
    const h = $s27.f0;
    const t = $s27.f1;
    return (() => { const $s29 = ys; if ($s29.tag === "Nil") {
        return false;
    } if ($s29.tag === "Cons") {
        const h2 = $s29.f0;
        const t2 = $s29.f1;
        return ((h === h2) && listEqInt(t)(t2));
    } throw new Error("non-exhaustive match"); })();
} throw new Error("non-exhaustive match"); })();
export const rowVals = (g) => (row) => (col) => ((col >= 9) ? Nil : (() => { const $s30 = getCell(g)(row)(col); if ($s30.tag === "Some") {
    const v = $s30.f0;
    return Cons(v)(rowVals(g)(row)((col + 1)));
} if ($s30.tag === "None") {
    return Nil;
} throw new Error("non-exhaustive match"); })());
export const colVals = (g) => (row) => (col) => ((row >= 9) ? Nil : (() => { const $s31 = getCell(g)(row)(col); if ($s31.tag === "Some") {
    const v = $s31.f0;
    return Cons(v)(colVals(g)((row + 1))(col));
} if ($s31.tag === "None") {
    return Nil;
} throw new Error("non-exhaustive match"); })());
export const setRowVals = (g) => (row) => (col) => (v) => ((col >= 8) ? g : setRowVals(setCell(g)(row)(col)(v))(row)((col + 1))((v + 1)));
export const unsolvableGrid = setCell(setRowVals(emptyGrid)(0)(0)(1))(5)(8)(9);
export const boxVals = (g) => (row) => (col) => (i) => ((i >= 9) ? Nil : (() => { const $s43 = getCell(g)((row + Math.trunc(i / 3)))((col + (i - (Math.trunc(i / 3) * 3)))); if ($s43.tag === "Some") {
    const v = $s43.f0;
    return Cons(v)(boxVals(g)(row)(col)((i + 1)));
} if ($s43.tag === "None") {
    return Nil;
} throw new Error("non-exhaustive match"); })());
export const allRowsSum45 = (g) => (row) => ((row >= 9) ? true : ((sum(rowVals(g)(row)(0)) === 45) && allRowsSum45(g)((row + 1))));
export const allColsSum45 = (g) => (col) => ((col >= 9) ? true : ((sum(colVals(g)(0)(col)) === 45) && allColsSum45(g)((col + 1))));
export const inRange1To9 = (v) => ((v >= 1) && (v <= 9));
export const allInRange = (xs) => (() => { const $s44 = xs; if ($s44.tag === "Nil") {
    return true;
} if ($s44.tag === "Cons") {
    const h = $s44.f0;
    const t = $s44.f1;
    return (inRange1To9(h) && allInRange(t));
} throw new Error("non-exhaustive match"); })();
export const cluesFromOriginal = (orig) => (dug) => (() => { const $s49 = dug; if ($s49.tag === "Nil") {
    return (() => { const $s50 = orig; if ($s50.tag === "Nil") {
        return true;
    } if ($s50.tag === "Cons") {
        const h2 = $s50.f0;
        const t2 = $s50.f1;
        return false;
    } throw new Error("non-exhaustive match"); })();
} if ($s49.tag === "Cons") {
    const h = $s49.f0;
    const t = $s49.f1;
    return (() => { const $s51 = orig; if ($s51.tag === "Nil") {
        return false;
    } if ($s51.tag === "Cons") {
        const h2 = $s51.f0;
        const t2 = $s51.f1;
        return (((h === 0) || (h === h2)) && cluesFromOriginal(t2)(t));
    } throw new Error("non-exhaustive match"); })();
} throw new Error("non-exhaustive match"); })();
export const zeroOrInRange = (v) => ((v === 0) || inRange1To9(v));
export const allZeroOrInRange = (xs) => (() => { const $s52 = xs; if ($s52.tag === "Nil") {
    return true;
} if ($s52.tag === "Cons") {
    const h = $s52.f0;
    const t = $s52.f1;
    return (zeroOrInRange(h) && allZeroOrInRange(t));
} throw new Error("non-exhaustive match"); })();
