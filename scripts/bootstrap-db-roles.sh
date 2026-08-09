#!/usr/bin/env bash
# Basecamp — one-time role password bootstrap.
#
# supabase/postgres's own docker-entrypoint-initdb.d scripts create the
# authenticator / supabase_auth_admin / supabase_storage_admin roles that
# auth, rest, and storage all connect as — but they don't set a password on
# any of them from POSTGRES_PASSWORD, even though every connection string in
# docker-compose.yml assumes they share it. Without this, auth/rest/storage
# fail SASL auth against a fresh db.
#
# Run this once, right after `docker compose up -d db` reports healthy, and
# BEFORE starting auth/rest/storage. Safe to re-run (idempotent).
set -euo pipefail
cd "$(dirname "$0")/.."

set -a
source .env
set +a

# Must connect as supabase_admin, not postgres — this image intentionally
# strips SUPERUSER from the postgres role and makes supabase_admin the real
# superuser instead; postgres alone can't ALTER these reserved roles.
docker compose exec -T -e PGPASSWORD="${POSTGRES_PASSWORD}" db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 <<SQL
alter role authenticator with password '${POSTGRES_PASSWORD}';
alter role supabase_auth_admin with password '${POSTGRES_PASSWORD}';
alter role supabase_storage_admin with password '${POSTGRES_PASSWORD}';
SQL

echo "Role passwords set."
