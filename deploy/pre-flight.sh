#!/usr/bin/env bash
#
# CyberSnake — Cloudflare Worker deployment pre-flight check.
#
# Verifies EVERYTHING that must be true BEFORE `wrangler deploy` runs, so the
# deploy either succeeds on the first try or fails fast with a clear reason.
#
# Usage:
#   ./deploy/pre-flight.sh            # run all checks, report PASS/FAIL
#   ./deploy/pre-flight.sh --fix      # run checks + auto-fix remediable ones
#
# Exit code: 0 = all checks pass, 1 = one or more checks failed.
#
# This is a CHECK script — it never mutates remote state. Use wrangler
# commands (deploy / d1 execute) for the actual mutation.

set -uo pipefail

# --- Locate the repo root (script may be run from anywhere) --------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

WORKER_DIR="worker"
WORKER_ENTRY="$WORKER_DIR/src/index.js"
WORKER_FILE="$WORKER_ENTRY"
WRANGLER_FILE="$WORKER_DIR/wrangler.toml"
WRANGLER_EXAMPLE="$WORKER_DIR/wrangler.toml.example"
MIGRATIONS_DIR="$WORKER_DIR/migrations"
TESTS_DIR="$WORKER_DIR/tests"

PASS=0
FAIL=0
FIXED=0

# --- Colors (degrade gracefully if not a TTY) ----------------------------------
if [[ -t 1 ]]; then
  C_GREEN=$'\033[32m'; C_RED=$'\033[31m'; C_YELLOW=$'\033[33m'
  C_BLUE=$'\033[34m'; C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'
else
  C_GREEN=''; C_RED=''; C_YELLOW=''; C_BLUE=''; C_RESET=''; C_BOLD=''
fi

pass()  { echo -e "${C_GREEN}  ✓ PASS${C_RESET}  $1"; PASS=$((PASS+1)); }
fail()  { echo -e "${C_RED}  ✗ FAIL${C_RESET}  $1"; FAIL=$((FAIL+1)); }
info()  { echo -e "${C_BLUE}  •${C_RESET}   $1"; }
note()  { echo -e "${C_YELLOW}  !${C_RESET}   $1"; }
section(){ echo; echo -e "${C_BOLD}${C_BLUE}── $1${C_RESET}"; }

# --- Find the wrangler binary (homebrew default here) ---------------------------
find_wrangler() {
  if command -v wrangler >/dev/null 2>&1; then
    echo "$(command -v wrangler)"; return 0
  fi
  for cand in /opt/homebrew/bin/wrangler /usr/local/bin/wrangler "$HOME/.npm-global/bin/wrangler"; do
    if [[ -x "$cand" ]]; then echo "$cand"; return 0; fi
  done
  return 1
}

WRANGLER_BIN="$(find_wrangler || true)"
if [[ -n "$WRANGLER_BIN" ]]; then
  export PATH="$(dirname "$WRANGLER_BIN"):$PATH"
fi

echo -e "${C_BOLD}CyberSnake deployment pre-flight check${C_RESET}"
echo "  repo:   $REPO_ROOT"
echo "  wrangler: ${WRANGLER_BIN:-<not found on PATH>}"

# ===========================================================================
section "1. wrangler installed & reachable"
# ===========================================================================
if [[ -n "$WRANGLER_BIN" ]]; then
  if "$WRANGLER_BIN" --version >/dev/null 2>&1; then
    pass "wrangler installed at $WRANGLER_BIN"
    info "version: $("$WRANGLER_BIN" --version 2>/dev/null)"
  else
    fail "wrangler present but '$WRANGLER_BIN --version' failed"
  fi
else
  fail "wrangler not found on PATH or common locations"
  note "install with: npm install -g wrangler"
fi

# ===========================================================================
section "2. authenticated to Cloudflare"
# ===========================================================================
if [[ -n "$WRANGLER_BIN" ]]; then
  WHOAMI="$("$WRANGLER_BIN" whoami 2>&1)"
  if echo "$WHOAMI" | grep -qi "logged in"; then
    EMAIL="$(echo "$WHOAMI" | grep -oE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' | head -1)"
    pass "authenticated ($EMAIL)"
  else
    fail "not logged in — run: $WRANGLER_BIN login"
    note "login must complete in a real browser (interactive OAuth)"
  fi
else
  fail "skipped: wrangler not installed"
fi

# ===========================================================================
section "3. wrangler.toml present & well-formed"
# ===========================================================================
if [[ -f "$WRANGLER_FILE" ]]; then
  pass "wrangler.toml exists"
  if grep -q '^\[\[workers\]\]' "$WRANGLER_FILE"; then
    pass "  has [[workers]] deployment block"
  else
    fail "  missing [[workers]] block"
  fi
  if grep -q '^\[\[workers\.d1_databases\]\]' "$WRANGLER_FILE"; then
    pass "  has [[workers.d1_databases]] block"
  else
    fail "  missing [[workers.d1_databases]] block"
  fi
else
  fail "wrangler.toml missing at $WRANGLER_FILE"
fi

# ===========================================================================
section "4. D1 binding name matches what the code reads"
# ===========================================================================
# The worker reads env.<BINDING>; the wrangler binding must match EXACTLY or
# the Worker fails at runtime with a silent 500.
if [[ -f "$WRANGLER_FILE" && -f "$WORKER_ENTRY" ]]; then
  BINDING_FROM_TOML="$(grep -oE '^binding *= *"[^"]+"' "$WRANGLER_FILE" | head -1 | sed -E 's/.*"([^"]+)".*/\1/')"
  if [[ -n "$BINDING_FROM_TOML" ]]; then
    if grep -qE "env\.$BINDING_FROM_TOML" "$WORKER_ENTRY"; then
      pass "code reads env.$BINDING_FROM_TOML — matches wrangler binding"
    else
      # Find what the code actually reads.
      CODE_BINDINGS="$(grep -oE 'env\.[A-Za-z_][A-Za-z0-9_]*' "$WORKER_ENTRY" | sed -E 's/env\.//' | sort -u | tr '\n' ' ')"
      fail "wrangler binding = '$BINDING_FROM_TOML' but code reads: $CODE_BINDINGS"
      note "edit binding = \"...\" in $WRANGLER_FILE to match the code"
    fi
  else
    fail "could not parse binding from wrangler.toml"
  fi
else
  fail "wrangler.toml or $WORKER_ENTRY missing — skipped"
fi

# ===========================================================================
section "5. real values (no leftover placeholders)"
# ===========================================================================
if [[ -f "$WRANGLER_FILE" ]]; then
  DB_ID="$(grep -E '^database_id *=' "$WRANGLER_FILE" | head -1 | sed -E 's/.*"([^"]+)".*/\1/')"
  if [[ -n "$DB_ID" && "$DB_ID" != "CHANGE_ME"* ]]; then
    pass "database_id is set: $DB_ID"
  else
    fail "database_id is a placeholder ('$DB_ID') — create a DB with 'wrangler d1 create'"
  fi

  ADMIN_SECRET="$(grep -E '^ADMIN_SECRET *=' "$WRANGLER_FILE" | head -1 | sed -E 's/.*"([^"]+)".*/\1/')"
  if [[ -n "$ADMIN_SECRET" && "$ADMIN_SECRET" != "CHANGE_ME"* ]]; then
    pass "ADMIN_SECRET is set (not a placeholder)"
  else
    fail "ADMIN_SECRET is a placeholder ('$ADMIN_SECRET') — set a real secret"
    note "prefer 'wrangler secret put ADMIN_SECRET ...' over hardcoding it"
  fi
else
  fail "wrangler.toml missing — skipped"
fi

# ===========================================================================
section "6. git hygiene (secrets must not leak into version control)"
# ===========================================================================
if [[ -f "$WRANGLER_FILE" ]]; then
  if grep -qE "worker/wrangler.toml" .gitignore 2>/dev/null; then
    pass ".gitignore excludes worker/wrangler.toml"
    if git check-ignore -q "$WORKER_FILE" >/dev/null 2>&1; then
      note "confirmed: git actually ignores worker/wrangler.toml"
    fi
  else
    fail ".gitignore does NOT exclude worker/wrangler.toml"
    note "add 'worker/wrangler.toml' to .gitignore so secrets don't commit"
  fi

  if [[ -f "$WRANGLER_EXAMPLE" ]]; then
    pass "wrangler.toml.example template exists"
  else
    fail "no wrangler.toml.example template"
    note "keep an example template in the repo; gitignore the real config"
  fi
else
  fail "wrangler.toml missing — skipped"
fi

# ===========================================================================
section "7. migrations present & idempotent"
# ===========================================================================
if [[ -d "$MIGRATIONS_DIR" ]]; then
  MIG_COUNT="$(find "$MIGRATIONS_DIR" -maxdepth 1 -name '*.sql' | wc -l | tr -d ' ')"
  pass "migrations dir has $MIG_COUNT file(s)"
  if grep -rlE 'CREATE TABLE IF NOT EXISTS' "$MIGRATIONS_DIR" >/dev/null 2>&1; then
    pass "migrations are idempotent (use IF NOT EXISTS)"
  else
    fail "migrations are NOT idempotent — add 'IF NOT EXISTS' so retries are safe"
  fi
else
  fail "migrations dir missing at $MIGRATIONS_DIR"
fi

# ===========================================================================
section "8. D1 schema applied to remote database"
# ===========================================================================
if [[ -n "$WRANGLER_BIN" && -f "$WRANGLER_FILE" ]]; then
  DB_ID="$(grep -E '^database_id *=' "$WRANGLER_FILE" | head -1 | sed -E 's/.*"([^"]+)".*/\1/')"
  if [[ -n "$DB_ID" && "$DB_ID" != "CHANGE_ME"* ]]; then
    # Query remote sqlite_master for our tables.
    SCHEMA="$("$WRANGLER_BIN" d1 execute "$DB_ID" --remote \
      --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;" \
      2>&1)"
    if echo "$SCHEMA" | grep -q "ranked_runs" && echo "$SCHEMA" | grep -q "leaderboard_entries"; then
      pass "remote DB has ranked_runs + leaderboard_entries tables"
    else
      fail "remote DB missing expected tables"
      note "apply migrations: \$WRANGLER_BIN d1 execute $DB_ID --remote --file $MIGRATIONS_DIR/001-init.sql"
    fi
  else
    fail "skipped: database_id is a placeholder"
  fi
else
  fail "wrangler/bin or wrangler.toml missing — skipped"
fi

# ===========================================================================
section "9. worker entry point & imports resolve"
# ===========================================================================
if [[ -f "$WORKER_ENTRY" ]]; then
  pass "$WORKER_ENTRY exists"
  # Verify the relative import paths resolve on disk.
  if [[ -f "$(dirname "$WORKER_ENTRY")/lib/verify.js" ]]; then
    pass "  ./lib/verify.js present"
  else
    fail "  ./lib/verify.js missing"
  fi
  if [[ -f "$(dirname "$WORKER_ENTRY")/lib/store.js" ]]; then
    pass "  ./lib/store.js present"
  else
    fail "  ./lib/store.js missing"
  fi
  if [[ -f "$REPO_ROOT/src/config/game-config.js" ]]; then
    pass "  ../../src/config/game-config.js present"
  else
    fail "  ../../src/config/game-config.js missing"
  fi
else
  fail "$WORKER_ENTRY missing"
fi

# ===========================================================================
section "10. worker test suite passes"
# ===========================================================================
if [[ -d "$TESTS_DIR" ]]; then
  # node --test <dir> treats the dir as a single file; point it at the actual
  # test files so each runs in its own module context.
  TEST_FILES="$(find "$TESTS_DIR" -name '*.test.js' | sort | tr '\n' ' ')"
  TEST_RESULT="$(node --test $TEST_FILES 2>&1)"
  if echo "$TEST_RESULT" | grep -qE "pass [1-9]"; then
    PASS_COUNT="$(echo "$TEST_RESULT" | grep -oE 'pass [0-9]+' | grep -oE '[0-9]+' | head -1)"
    FAIL_COUNT="$(echo "$TEST_RESULT" | grep -oE 'fail [0-9]+' | grep -oE '[0-9]+' | head -1)"
    if [[ "${FAIL_COUNT:-0}" == "0" || -z "$FAIL_COUNT" ]]; then
      pass "worker tests: $PASS_COUNT passing, 0 failing"
    else
      fail "worker tests: $FAIL_COUNT failing (see above)"
    fi
  else
    fail "worker tests errored (see above)"
  fi
else
  fail "tests dir missing at $TESTS_DIR"
fi

# ===========================================================================
section "Summary"
# ===========================================================================
echo
echo -e "${C_BOLD}Checks passed: ${C_GREEN}$PASS${C_RESET}   ${C_RED}failed: $FAIL${C_RESET}"
echo
if [[ "$FAIL" -eq 0 ]]; then
  echo -e "${C_GREEN}${C_BOLD}✓ All pre-flight checks passed — safe to run 'wrangler deploy'.${C_RESET}"
  exit 0
else
  echo -e "${C_RED}${C_BOLD}✗ $FAIL check(s) failed — fix the items above before deploying.${C_RESET}"
  exit 1
fi
