#!/bin/bash
# True-parallel swarm baseline: N separate worker processes drain the shared
# Sudoku queue concurrently — real wall-clock parallelism across the graph's
# width, unlike the in-process (serial) driver.
#
#   ./scripts/parallel-swarm-sudoku.sh [provider] [workers]
set -euo pipefail

PROVIDER="${1:-claude}"
WORKERS="${2:-4}"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/strand-parallel-$PROVIDER-XXXXXX")"
cd "$(dirname "$0")/.."

STRAND="npx tsx src/cli.ts"
SWARM="npx tsx src/swarm/cli.ts"

STRAND_ROOT="$ROOT" $STRAND init >/dev/null
STRAND_ROOT="$ROOT" $STRAND submit --as prelude --intent prelude --file lib/prelude.strand >/dev/null
STRAND_ROOT="$ROOT" $STRAND merge >/dev/null
$SWARM plan --root "$ROOT" >/dev/null

echo "parallel $PROVIDER swarm: $WORKERS worker processes in $ROOT"
START=$(date +%s)

PIDS=()
for i in $(seq 1 "$WORKERS"); do
  $SWARM work --as "pw$i" --provider "$PROVIDER" --root "$ROOT" --poll 5000 --idle 30 &
  PIDS+=($!)
done
for pid in "${PIDS[@]}"; do wait "$pid"; done

SECS=$(( $(date +%s) - START ))
echo ""
echo "=== parallel $PROVIDER swarm ($WORKERS procs) ==="
$SWARM status --root "$ROOT" | head -3
echo "wall clock        : ${SECS}s"
echo ""
echo "strand test:"
STRAND_ROOT="$ROOT" $STRAND test || true
echo ""
echo "eval isUnique (generate 0 8):"
STRAND_ROOT="$ROOT" $STRAND eval "isUnique (generate 0 8)" || true
