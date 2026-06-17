#!/usr/bin/env bash
# Strand demo: three agents author the same "codebase" in parallel. Only the one
# name two of them truly contend over is parked; everything else auto-merges.
set -e
CLI="$(cd "$(dirname "$0")/.." && pwd)/src/cli.ts"
D=$(mktemp -d)
export STRAND_ROOT="$D"
strand() { npx tsx "$CLI" "$@"; }

echo "## init"; strand init

echo "## agent-12 (validate email on signup)"
strand submit --as agent-12 --intent "validate email on signup" --code "
def auth -> Int = 1
def validateEmail -> Int = 7
def signup -> Int = validateEmail + auth"

echo "## agent-37 (hash password on signup)"
strand submit --as agent-37 --intent "hash password on signup" --code "
def hashPassword -> Int = 9
def signup -> Int = hashPassword + 1"

echo "## agent-50 (rate-limit login)"
strand submit --as agent-50 --intent "rate-limit login" --code "
def rateLimit -> Int = 3
def login -> Int = rateLimit + 100"

echo "## merge"; strand merge || true
echo "## namespace"; strand ls
echo "## eval login (interpreter):"; strand eval "login"
echo "## run login (transpiled TypeScript):"; strand run login

echo "## resolve signup -> agent-37"
H=$(strand conflicts | grep agent-37 | awk '{print $2}')
strand resolve signup "$H"
echo "## namespace after resolve"; strand ls

rm -rf "$D"
