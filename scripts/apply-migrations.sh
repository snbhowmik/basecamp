#!/usr/bin/env bash
# Basecamp — apply $MIGRATION_DIR/*.sql in order, over docker compose exec.
# Run after `auth` reports healthy (its own migrations create auth.mfa_factors,
# which 0001_foundation.sql depends on — see docker-compose.yml's db service
# comment for why these aren't auto-mounted into docker-entrypoint-initdb.d).
#
# This now points at supabase/schema-v2, which is a complete replacement
# baseline, NOT a set of migrations onto v1. It only ever runs against an
# empty database. Applying it to the live v1 instance fails on the first file
# (`relation "profiles" already exists`) — that is psql -1, so it rolls back
# whole and records nothing, but it is not a migration path. To move the live
# instance to v2 you reset it: docker compose down -v, then re-run from
# scratch. See HANDOFF.md §3.
#
# The ledger keys on filename, and v2's filenames differ from v1's, so a
# database carrying v1's ledger rows will NOT skip these — it will attempt
# them and fail as described. Retire supabase/migrations/ once v2 is proven.
#
# Tracks what has already been applied in basecamp_meta.schema_migrations, so
# this is safe to re-run and only ever applies new files. The earlier version
# of this script re-ran every file from 0001 with ON_ERROR_STOP=1, which meant
# it worked exactly once — on an empty database — and then died on
# `relation "profiles" already exists` forever after, never reaching the new
# migration it was invoked to apply.
#
# The ledger lives in basecamp_meta, NOT public, deliberately: PostgREST
# exposes everything in the schemas listed in PGRST_DB_SCHEMAS (just `public`),
# so a ledger table in public would be a readable API endpoint for no reason.
#
# Each file runs in a single transaction (psql -1), so a migration that fails
# halfway leaves nothing behind and is not recorded as applied.
#
# Does NOT run supabase/seed.sql — that file is example/demo catalog data
# only, never for a real deployment. The wizard creates the captain account;
# the captain creates everything else (levels, departments, tags, other
# accounts) by hand, through the app, after first boot. No fixture data.
#
# Usage:
#   ./scripts/apply-migrations.sh                 apply everything not yet applied
#   MIGRATION_DIR=supabase/migrations ./scripts/apply-migrations.sh
#                                                 apply the retired v1 set
#   ./scripts/apply-migrations.sh --baseline 0007 record 0001..0007 as applied
#                                                 WITHOUT running them — for a
#                                                 database that predates this
#                                                 ledger. Verify those really
#                                                 are applied before using it.
set -euo pipefail
cd "$(dirname "$0")/.."

MIGRATION_DIR="${MIGRATION_DIR:-supabase/schema-v2}"

set -a
source .env
set +a

BASELINE=""
if [ "${1:-}" = "--baseline" ]; then
  BASELINE="${2:?--baseline needs a migration prefix, e.g. 0007}"
fi

psql_run() {
  docker compose exec -T -e PGPASSWORD="${POSTGRES_PASSWORD}" db \
    psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 "$@"
}

psql_quiet() {
  docker compose exec -T -e PGPASSWORD="${POSTGRES_PASSWORD}" db \
    psql -U supabase_admin -d postgres -tAq -v ON_ERROR_STOP=1 "$@"
}

psql_run -q <<'SQL' >/dev/null
create schema if not exists basecamp_meta;
create table if not exists basecamp_meta.schema_migrations (
  filename   text primary key,
  applied_at timestamptz not null default now()
);
revoke all on schema basecamp_meta from public;
SQL

applied=0
skipped=0

for f in "$MIGRATION_DIR"/*.sql; do
  name="$(basename "$f")"

  already="$(psql_quiet -c "select 1 from basecamp_meta.schema_migrations where filename = '${name}'")"
  if [ -n "$already" ]; then
    skipped=$((skipped + 1))
    continue
  fi

  # Baseline mode: record without running, for files at or below the given
  # prefix. Everything above it still gets applied normally.
  if [ -n "$BASELINE" ] && [[ "$name" < "$BASELINE" || "$name" == "$BASELINE"* ]]; then
    psql_quiet -c "insert into basecamp_meta.schema_migrations (filename) values ('${name}')" >/dev/null
    echo "Baselined (not run): $name"
    skipped=$((skipped + 1))
    continue
  fi

  echo "Applying $name ..."
  psql_run -1 < "$f"
  psql_quiet -c "insert into basecamp_meta.schema_migrations (filename) values ('${name}')" >/dev/null
  applied=$((applied + 1))
done

echo "Migrations: ${applied} applied, ${skipped} already present."
