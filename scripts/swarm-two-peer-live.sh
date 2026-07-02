#!/bin/bash
# The two-peer live rehearsal of the #38 runbook: two separate stores, two
# serve processes, token-authenticated HTTP gossip, GitHub as the shared task
# board, a real model authoring. Machine A lands the base def; machine B's
# task only typechecks because gossip pulled A's work across first. Ends by
# comparing Merkle roots: one green namespace.
#
#   STRAND_SYNC_TOKEN=<secret> ./scripts/swarm-two-peer-live.sh [provider] [owner/repo]
set -euo pipefail

PROVIDER="${1:-claude}"
BOARD="${2:-flogvit/strand}"
: "${STRAND_SYNC_TOKEN:?set STRAND_SYNC_TOKEN}"

cd "$(dirname "$0")/.."
STRAND="npx tsx src/cli.ts"
SWARM="npx tsx src/swarm/cli.ts"

A="$(mktemp -d "${TMPDIR:-/tmp}/strand-peerA-XXXXXX")"
B="$(mktemp -d "${TMPDIR:-/tmp}/strand-peerB-XXXXXX")"
for R in "$A" "$B"; do STRAND_ROOT="$R" $STRAND init >/dev/null; done

PORT_A=4141
PORT_B=4142
$SWARM serve --root "$A" --port $PORT_A >"$A/serve.log" 2>&1 &
SERVE_A=$!
$SWARM serve --root "$B" --port $PORT_B >"$B/serve.log" 2>&1 &
SERVE_B=$!
trap 'kill $SERVE_A $SERVE_B 2>/dev/null || true' EXIT

# seed a two-step chain on the shared board: the second def needs the first
npx tsx -e "
import { GhQueue } from './src/swarm/ghqueue.ts';
import { seed } from './src/swarm/plan.ts';
const q = new GhQueue({ repo: '$BOARD' });
const tasks = seed(q, [
  { name: 'chainBase', intent: 'the base value both machines must agree on', deps: [],
    spec: 'chainBase : Int — the constant 21', test: false, helperPrefix: 'chainBase' },
  { name: 'chainDouble', intent: 'twice the base', deps: ['chainBase'],
    spec: 'chainDouble : Int — chainBase * 2 == 42', test: false, helperPrefix: 'chainDouble' },
], '$A');
console.log('board tasks:', tasks.map(t => '#' + t.id).join(' '));
"

START=$(date +%s)
# machine A: takes the only claimable task (chainBase), then drains idle
$SWARM work --as a1 --provider "$PROVIDER" --root "$A" --gh "$BOARD" --peers "http://127.0.0.1:$PORT_B" --poll 4000 --idle 3
# machine B: can only do chainDouble if gossip pulled chainBase from A
$SWARM work --as b1 --provider "$PROVIDER" --root "$B" --gh "$BOARD" --peers "http://127.0.0.1:$PORT_A" --poll 4000 --idle 3
# one more pull A<-B so A also has B's work
npx tsx -e "
import { gossipOnce } from './src/distributed/transport.ts';
(async () => {
  const r = await gossipOnce('$A', ['http://127.0.0.1:$PORT_B']);
  console.log('final anti-entropy A<-B:', JSON.stringify(r));
})();
"
SECS=$(( $(date +%s) - START ))

echo ""
echo "=== two-peer live run ($PROVIDER, board $BOARD) ==="
echo "wall clock: ${SECS}s"
for R in "$A" "$B"; do
  echo "peer $R:"
  STRAND_ROOT="$R" $STRAND eval "chainDouble" || true
done
npx tsx -e "
import { buildIndex, indexToJSON } from './src/distributed/merkle.ts';
import { loadRepo } from './src/persist.ts';
const a = indexToJSON(buildIndex(loadRepo('$A').store.hashes())).digest;
const b = indexToJSON(buildIndex(loadRepo('$B').store.hashes())).digest;
console.log('merkle A:', a);
console.log('merkle B:', b);
console.log(a === b ? 'CONVERGED: one green namespace' : 'NOT CONVERGED');
"
