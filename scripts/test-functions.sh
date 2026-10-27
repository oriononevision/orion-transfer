#!/usr/bin/env bash
# Teste les fonctions serveur de bout en bout sur une base PostgreSQL locale
# jetable (migration réelle) avec un stockage en mémoire. Nécessite Deno 2
# et PostgreSQL 15+ (PGHOST, PGPORT, PGUSER).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="${TRANSFER_FN_TEST_DB:-transfer_fn_test}"
PSQL=(psql -X -q -v ON_ERROR_STOP=1)
DENO="${DENO:-deno}"

"${PSQL[@]}" -d postgres -c "drop database if exists ${DB}" >/dev/null 2>&1
"${PSQL[@]}" -d postgres -c "create database ${DB}" >/dev/null
"${PSQL[@]}" -d "$DB" -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null 2>&1
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d "$DB" -f "$f" >/dev/null 2>&1 || "${PSQL[@]}" -d "$DB" -f "$f"
done

cd "$ROOT/supabase/functions"
DATABASE_URL="postgres://${PGUSER:-postgres}@${TRANSFER_TCP_HOST:-localhost}:${PGPORT:-5432}/${DB}" \
  "$DENO" test --allow-env --allow-net --allow-read --allow-sys tests/

"${PSQL[@]}" -d postgres -c "drop database if exists ${DB}" >/dev/null
