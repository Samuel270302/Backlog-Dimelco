#!/usr/bin/env bash
# Crea un PostgreSQL temporal, aplica las migraciones y corre probar_transiciones.sql.
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)}"
DIR="$(mktemp -d)"
PUERTO="${PUERTO:-55432}"
COMO=""; [ "$(id -u)" = "0" ] && { chown -R postgres "$DIR"; COMO="runuser -u postgres --"; }
trap '[ $? -ne 0 ] && tail -5 "$DIR/log" >&2 2>/dev/null; $COMO "$PGBIN/pg_ctl" -D "$DIR/datos" stop -m fast >/dev/null 2>&1 || true; rm -rf "$DIR"' EXIT
$COMO "$PGBIN/initdb" -D "$DIR/datos" -U postgres -A trust >/dev/null
$COMO "$PGBIN/pg_ctl" -D "$DIR/datos" -o "-p $PUERTO -k $DIR" -l "$DIR/log" start -w >/dev/null
PSQL=(psql -h "$DIR" -p "$PUERTO" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X)
export PGOPTIONS="-c client_min_messages=warning"
"${PSQL[@]}" -f "$RAIZ/tools/base_local.sql"
for f in "$RAIZ"/supabase/migrations/*.sql; do "${PSQL[@]}" -f "$f"; done
"${PSQL[@]}" -f "$RAIZ/tools/probar_transiciones.sql"
