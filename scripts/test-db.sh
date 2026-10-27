#!/usr/bin/env bash
# Teste la migration et les règles d'accès sur une base PostgreSQL locale
# jetable (aucun lien avec Supabase). Nécessite PostgreSQL 15+ installé.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="${TRANSFER_TEST_DB:-transfer_test}"
PSQL=(psql -X -q -v ON_ERROR_STOP=1)

"${PSQL[@]}" -d postgres -c "drop database if exists ${DB}" >/dev/null
"${PSQL[@]}" -d postgres -c "create database ${DB}" >/dev/null

"${PSQL[@]}" -d "$DB" -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d "$DB" -f "$f" >/dev/null 2>&1 || "${PSQL[@]}" -d "$DB" -f "$f"
done
# Deux passages : la migration doit pouvoir être rejouée sans erreur.
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d "$DB" -f "$f" >/dev/null 2>&1 || "${PSQL[@]}" -d "$DB" -f "$f"
done

"${PSQL[@]}" -d "$DB" -f "$ROOT/supabase/tests/transfer_access_test.sql" 2>&1 | sed 's/^psql:[^ ]* NOTICE:  /  /'

"${PSQL[@]}" -d postgres -c "drop database if exists ${DB}" >/dev/null
