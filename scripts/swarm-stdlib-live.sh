#!/bin/bash
# The wide-graph parallel measurement (#36): N worker processes drain the
# ~100-task stdlib decomposition concurrently. Prints parallel wall clock,
# the serial cost (Σ per-task seconds across workers) and the speedup — plus
# strand test / untested, so 'done' is checkable, not asserted.
#
#   ./scripts/swarm-stdlib-live.sh [provider] [workers]
set -euo pipefail

PROVIDER="${1:-claude}"
WORKERS="${2:-8}"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/strand-stdlib-$PROVIDER-XXXXXX")"
cd "$(dirname "$0")/.."

STRAND="npx tsx src/cli.ts"
SWARM="npx tsx src/swarm/cli.ts"

STRAND_ROOT="$ROOT" $STRAND init >/dev/null
STRAND_ROOT="$ROOT" $STRAND submit --as prelude --intent prelude --file lib/prelude.strand >/dev/null
STRAND_ROOT="$ROOT" $STRAND merge >/dev/null
$SWARM plan --stdlib --root "$ROOT" >/dev/null

echo "stdlib swarm: $WORKERS $PROVIDER worker processes in $ROOT"
$SWARM status --root "$ROOT" | head -1
START=$(date +%s)

LOGS=()
PIDS=()
for i in $(seq 1 "$WORKERS"); do
  LOG="$ROOT/worker-$i.log"
  LOGS+=("$LOG")
  $SWARM work --as "sw$i" --provider "$PROVIDER" --root "$ROOT" --poll 5000 --idle 24 >"$LOG" 2>&1 &
  PIDS+=($!)
done
for pid in "${PIDS[@]}"; do wait "$pid" || true; done

SECS=$(( $(date +%s) - START ))
SERIAL=$(cat "${LOGS[@]}" | awk -F'[=s]' '/^timing /{s+=$2} END{printf "%.0f", s}')

echo ""
echo "=== stdlib swarm ($WORKERS procs, $PROVIDER) ==="
$SWARM status --root "$ROOT" | head -1
echo "parallel wall clock : ${SECS}s"
echo "serial cost (Σ task): ${SERIAL}s"
echo "speedup             : $(awk -v a="$SERIAL" -v b="$SECS" 'BEGIN{printf "%.1fx", a/b}')"
echo ""
echo "strand test:"
STRAND_ROOT="$ROOT" $STRAND test | tail -1
echo "strand untested:"
STRAND_ROOT="$ROOT" $STRAND untested | head -5
echo ""
echo "root kept at $ROOT (workers' logs inside)"
