#!/usr/bin/env bash
# Run the acceptance suite against a node, with the environment checks and forensics that a run needs
# to be *evidence* rather than an anecdote.
#
# Why this exists: the Docker healthcheck is a serving check (`curl /api/status`), so a container
# reads "(healthy)" while the chain is frozen. Nothing in tools/ ever asserts that the chain is
# *advancing*. A run that does not check that can spend minutes producing results that mean nothing —
# which is what happened.
#
# Usage: scripts/acceptance.sh [--record] [--node <url>] [--] [extra suite args]
#
# Exit: 0 the suite passed; 1 the suite failed; 2 the environment failed its preconditions.

set -uo pipefail

NODE="http://localhost:40403"
ADMIN="http://localhost:40405"
SUITE_ARGS=()

while [ $# -gt 0 ]; do
    case "$1" in
        --node) NODE="$2"; shift 2 ;;
        *) SUITE_ARGS+=("$1"); shift ;;
    esac
done

FAIL=0
pass() { printf '  PASS  %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; FAIL=1; }

value() { sed -n "s/.*\"$2\":\([0-9]*\).*/\1/p" <<< "$1"; }

echo "== environment preconditions ($NODE) =="

# 1. Serving, and the fields that must be present.
STATUS="$(curl -fsS -m 10 "$NODE/api/status" 2>/dev/null)"
if [ -z "$STATUS" ]; then
    fail "node serves /api/status"
else
    pass "node serves /api/status"
    grep -q '"shardId":"/root"' <<< "$STATUS" && pass 'shardId is /root' || fail 'shardId is /root'
    grep -q '"devMode":true'   <<< "$STATUS" && pass 'devMode is true'   || fail 'devMode is true'
fi

# 2. The chain is ADVANCING — the check whose absence made a frozen node look fine. `latestBlockNumber`
#    is the only field that moves with the chain; `autopropose` stays true after a halt.
B1="$(value "$STATUS" latestBlockNumber)"
sleep 10
B2="$(value "$(curl -fsS -m 10 "$NODE/api/status" 2>/dev/null)" latestBlockNumber)"
if [ -n "$B1" ] && [ -n "$B2" ] && [ "$B2" -gt "$B1" ]; then
    pass "chain advancing ($B1 -> $B2)"
else
    echo "  ... no advance ($B1 -> $B2); forcing a proposal"
    curl -fsS -m 15 -X POST "$ADMIN/api/v1/propose" >/dev/null 2>&1
    sleep 5
    B3="$(value "$(curl -fsS -m 10 "$NODE/api/status" 2>/dev/null)" latestBlockNumber)"
    if [ -n "$B3" ] && [ -n "$B2" ] && [ "$B3" -gt "$B2" ]; then
        pass "chain advances when a block is forced ($B2 -> $B3)"
    else
        fail "chain is WEDGED: height frozen at $B2 and a forced propose did not move it"
    fi
fi

# 3. No autopropose halt in the log (the one diagnostic the node does emit for a stopped proposer).
HALTED="$(docker logs devnet-bootstrap 2>&1 | grep -c 'halted after' || true)"
[ "$HALTED" = "0" ] && pass "no autopropose halt logged" || fail "autopropose halted ($HALTED lines)"

# 4. No backlog: a pool that is not draining means a run in flight, or a wedge.
POOLED="$(curl -fsS -m 10 "$NODE/api/v1/deploys" 2>/dev/null | grep -o '"deployId"' | wc -l)"
[ "${POOLED:-0}" -le 2 ] && pass "pool drained ($POOLED pooled)" || fail "pool has $POOLED deploys — not starting a run over it"

if [ "$FAIL" != "0" ]; then
    echo
    echo "Environment failed its preconditions. Not running the suite: results would not be evidence."
    echo "  tools/devnet.sh down -v && tools/devnet.sh up --validators 1   # then re-run this script"
    exit 2
fi

# Forensics: sample the chain while the suite runs, so a wedge is attributed from data rather than
# reconstructed afterwards (the suite cannot see a wedge that starts after its last case).
SAMPLES="$(mktemp)"; trap 'rm -f "$SAMPLES"' EXIT
(
    while true; do
        S="$(curl -fsS -m 5 "$NODE/api/status" 2>/dev/null)"
        P="$(curl -fsS -m 5 "$NODE/api/v1/deploys" 2>/dev/null | grep -o '"deployId"' | wc -l)"
        printf '%s height=%s pooled=%s\n' "$(date +%H:%M:%S)" "$(value "$S" latestBlockNumber)" "${P:-0}" >> "$SAMPLES"
        sleep 5
    done
) &
SAMPLER=$!
trap 'kill "$SAMPLER" 2>/dev/null; rm -f "$SAMPLES"' EXIT

echo
echo "== suite =="
npm run test:output -- --node "$NODE" "${SUITE_ARGS[@]}"
SUITE=$?

kill "$SAMPLER" 2>/dev/null
echo
echo "== chain during the run (last 20 samples) =="
tail -20 "$SAMPLES"
NEWHALT="$(docker logs devnet-bootstrap 2>&1 | grep -c 'halted after' || true)"
[ "$NEWHALT" != "0" ] && echo "!! autopropose halted during the run: $(docker logs devnet-bootstrap 2>&1 | grep 'halted after' | tail -1)"

exit "$SUITE"
