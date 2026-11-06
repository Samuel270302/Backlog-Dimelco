#!/usr/bin/env bash
# Prueba de extremo a extremo: PostgreSQL temporal con las migraciones y la semilla,
# app construida y navegador (Playwright) recorriendo el flujo con dos usuarios.
# Uso: tests/e2e.sh                 flujo completo en Chromium
#      tests/e2e.sh electron.mjs    la app de escritorio (Electron) con PDF, Excel y fotos
#      tests/e2e.sh movil.mjs       el sitio web en pantalla de celular
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)}"
DIR="$(mktemp -d)"
export PGPORT="${PGPORT:-55435}"
export PGHOST="$DIR"
COMO=""; [ "$(id -u)" = "0" ] && { chown -R postgres "$DIR"; COMO="runuser -u postgres --"; }
trap '$COMO "$PGBIN/pg_ctl" -D "$DIR/datos" stop -m fast >/dev/null 2>&1 || true; rm -rf -- "$DIR"' EXIT
$COMO "$PGBIN/initdb" -D "$DIR/datos" -U postgres -A trust >/dev/null
$COMO "$PGBIN/pg_ctl" -D "$DIR/datos" -o "-p $PGPORT -k $DIR" -l "$DIR/log" start -w >/dev/null
export PGOPTIONS="-c client_min_messages=warning"
PSQL=(psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X)
"${PSQL[@]}" -f "$RAIZ/tools/base_local.sql"
for f in "$RAIZ"/supabase/migrations/*.sql; do "${PSQL[@]}" -f "$f"; done
"${PSQL[@]}" -f "$RAIZ/tests/semilla_e2e.sql"
GUION="${1:-flujo_backlog.mjs}"
if [ "${SIN_BUILD:-}" != "1" ]; then
  case "$GUION" in
    electron.mjs) (cd "$RAIZ" && npm run build >/dev/null) ;;
    # Sitio web con la conexión fija hacia el servidor REST de prueba (como en GitHub Pages).
    movil.mjs) (cd "$RAIZ" && VITE_SUPABASE_URL=http://localhost:5192 VITE_SUPABASE_ANON_KEY=llave-anon-de-prueba-0123456789 npx vite build --mode web --logLevel warn) ;;
    *) (cd "$RAIZ" && npx vite build --logLevel warn) ;;
  esac
fi
if [ "$GUION" = "electron.mjs" ]; then
  PGOPTIONS="" xvfb-run -a node "$RAIZ/tests/$GUION"
else
  PGOPTIONS="" node "$RAIZ/tests/$GUION"
fi
