#!/usr/bin/env bash
# Une las migraciones en supabase/instalar_todo.sql para pegarlas de una vez en el SQL Editor.
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
{
  echo "-- Instalación completa de la base de backlog (generado por tools/armar_instalacion.sh)."
  echo "-- Pegar todo en el SQL Editor del proyecto Supabase NUEVO y ejecutar. Se puede repetir."
  for f in "$RAIZ"/supabase/migrations/*.sql; do
    echo; echo "-- ===== $(basename "$f") ====="; cat "$f"
  done
} > "$RAIZ/supabase/instalar_todo.sql"
echo "supabase/instalar_todo.sql armado"
