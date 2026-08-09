#!/usr/bin/env bash
# Basecamp — apply supabase/migrations/*.sql in order, over docker compose exec.
# Run after `auth` reports healthy (its own migrations create auth.mfa_factors,
# which 0001_schema.sql depends on — see docker-compose.yml's db service
# comment for why these aren't auto-mounted into docker-entrypoint-initdb.d).
#
# Does NOT run supabase/seed.sql — that file is example/demo catalog data
# only, never for a real deployment. The wizard creates the captain account;
# the captain creates everything else (levels, departments, tags, other
# accounts) by hand, through the app, after first boot. No fixture data.
set -euo pipefail
cd "$(dirname "$0")/.."

set -a
source .env
set +a

for f in supabase/migrations/*.sql; do
  echo "Applying $f ..."
  docker compose exec -T -e PGPASSWORD="${POSTGRES_PASSWORD}" db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 < "$f"
done

echo "Migrations applied."
