# CyberSnake — Cloudflare Worker Deployment

Deploy the CyberSnake ranking worker to Cloudflare Workers + D1.

## Pre-flight check (always run first)

```bash
./deploy/pre-flight.sh
```

This checks every precondition before `wrangler deploy` runs:

1. wrangler installed & reachable
2. authenticated to Cloudflare (interactive browser login)
3. wrangler.toml present with `[[workers]]` + `[[workers.d1_databases]]` blocks
4. D1 binding name matches what the code reads (`env.D1`)
5. real values (no `CHANGE_ME_*` placeholders) — database_id, ADMIN_SECRET
6. git hygiene — `worker/wrangler.toml` gitignored, `wrangler.toml.example` kept
7. migrations present & idempotent (`IF NOT EXISTS`)
8. D1 schema applied to the remote database
9. worker entry point & all imports resolve on disk
10. worker test suite passes (39/39)

Exit code 0 = safe to deploy; 1 = fix the flagged items first.

## One-time setup

```bash
# 1. Install wrangler (homebrew prefix here)
npm install -g wrangler

# 2. Log in interactively (must complete in a real browser)
wrangler login

# 3. Create the D1 database (once)
wrangler d1 create cybersnake-db

# 4. Apply the schema to the remote DB
wrangler d1 execute cybersnake-db --remote --file worker/migrations/001-init.sql

# 5. Set the admin secret (preferred over hardcoding in wrangler.toml)
wrangler secret put ADMIN_SECRET --name cybersnake
#   ...or edit worker/wrangler.toml ADMIN_SECRET and keep it gitignored
```

## Deploy

```bash
./deploy/pre-flight.sh   # must all pass first
wrangler deploy --config worker/wrangler.toml
```

Notes:
- The `[[workers.d1_databases]]` nested form is required for Worker deployment.
  wrangler 4.x `d1 migrations apply` cannot resolve a nested binding, so apply
  migrations with `d1 execute ... --file` instead.
- `wrangler login` persists the OAuth token to `~/.wrangler/config/default.toml`.
  In a non-interactive shell, export the wrangler bin dir on PATH or login may
  appear to fail even after a successful browser auth.
