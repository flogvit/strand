#!/usr/bin/env bash
# Strand over real TypeScript: agents author actual .ts definitions in parallel.
# Only the one name two of them contend over parks; everything else auto-merges,
# and the real TypeScript compiler is the green-gate.
set -e
CLI="$(cd "$(dirname "$0")/.." && pwd)/src/ts/cli.ts"
D=$(mktemp -d); export STRAND_ROOT="$D"
strand() { npx tsx "$CLI" "$@"; }

echo "## init"; strand init

echo "## alice: add"
strand submit --as alice --intent "adder" --code 'export function add(a: number, b: number): number { return a + b; }'
strand merge

echo "## bob and carol both define double (different bodies); dave defines triple"
strand submit --as bob   --intent "double via add"   --code 'export const double = (n: number): number => add(n, n);'
strand submit --as carol --intent "double via add+0" --code 'export const double = (n: number): number => add(n, add(n, 0));'
strand submit --as dave  --intent "tripler"          --code 'export const triple = (n: number): number => add(add(n, n), n);'

echo "## merge (double parks, triple auto-merges)"; strand merge || true
echo "## namespace"; strand ls

echo "## the real tsc green-gate rejects a type error:"
strand submit --as eve --intent bad --code 'export const oops: number = "not a number";' || true

echo "## eval triple(5) — runs the assembled real TypeScript:"; strand eval "triple(5)"

echo "## resolve double -> carol, then build the module:"
H=$(strand conflicts | grep carol | awk '{print $2}')
strand resolve double "$H"
strand build

rm -rf "$D"
