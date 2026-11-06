#!/usr/bin/env bash
# Prueba de tools/exportar_usuarios_preventivos.sql: dos bases locales con un esquema auth
# parecido al de Supabase (con columnas generadas), una hace de "preventivos" y la otra
# de "backlog" con las migraciones. Copia los usuarios y revisa que queden igual.
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)}"
DIR="$(mktemp -d)"; PUERTO="${PUERTO:-55560}"
COMO=""; [ "$(id -u)" = "0" ] && { chown -R postgres "$DIR"; COMO="runuser -u postgres --"; }
trap '$COMO "$PGBIN/pg_ctl" -D "$DIR/datos" stop -m fast >/dev/null 2>&1 || true; rm -rf -- "$DIR"' EXIT
$COMO "$PGBIN/initdb" -D "$DIR/datos" -U postgres -A trust >/dev/null
$COMO "$PGBIN/pg_ctl" -D "$DIR/datos" -o "-p $PUERTO -k $DIR" -l "$DIR/log" start -w >/dev/null
export PGOPTIONS="-c client_min_messages=warning"
P() { psql -h "$DIR" -p "$PUERTO" -U postgres -X -q -v ON_ERROR_STOP=1 "$@"; }
P -c "create database prev" -c "create database back"

AUTH='
create extension if not exists pgcrypto;
create schema if not exists auth;
create table if not exists auth.users (
  instance_id uuid, id uuid primary key, aud varchar(255), role varchar(255), email varchar(255),
  encrypted_password varchar(255), email_confirmed_at timestamptz, invited_at timestamptz,
  confirmation_token varchar(255), recovery_token varchar(255), email_change_token_new varchar(255),
  email_change varchar(255), raw_app_meta_data jsonb, raw_user_meta_data jsonb, is_super_admin boolean,
  created_at timestamptz, updated_at timestamptz, phone text, phone_confirmed_at timestamptz,
  confirmed_at timestamptz generated always as (least(email_confirmed_at, phone_confirmed_at)) stored,
  is_anonymous boolean not null default false);
create unique index if not exists users_email_key on auth.users (lower(email));
create table if not exists auth.identities (
  provider_id text not null, user_id uuid not null references auth.users(id) on delete cascade,
  identity_data jsonb not null, provider text not null, last_sign_in_at timestamptz,
  created_at timestamptz, updated_at timestamptz,
  email text generated always as (lower(identity_data ->> '"'"'email'"'"')) stored,
  id uuid not null default gen_random_uuid() primary key, unique (provider_id, provider));'

# Preventivos: usuarios, perfiles y unidades con la forma de esa app.
P -d prev -c "$AUTH"
P -d prev <<'SQL'
create table unidades (id uuid primary key default gen_random_uuid(), nombre text, orden int);
create table perfiles (user_id uuid primary key, nombre text, correo text, rol text, activo boolean, unidad_id uuid);
insert into unidades (nombre, orden) values ('HEMCO',1),('Veta Nueva',2),('Mina La India',3),('Explotec',4);
insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,confirmation_token,recovery_token,email_change_token_new,email_change,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated','authenticated', v.correo,
       crypt(v.clave, gen_salt('bf')), now(), '', '', '', '', '{"provider":"email","providers":["email"]}'::jsonb,
       jsonb_build_object('nombre', v.nombre), now() - (v.n || ' days')::interval, now()
from (values ('a@dimelco.test','Ana Admin','clave-ana',1), ('c@dimelco.test','Carlos Capturador','clave-carlos',2),
             ('v@dimelco.test','Vera O''Brien','clave-vera',3), ('i@dimelco.test','Inés Invitada','clave-ines',4)) v(correo,nombre,clave,n);
insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
select id::text, id, jsonb_build_object('sub', id::text, 'email', email), 'email', created_at, updated_at from auth.users;
insert into perfiles (user_id, nombre, correo, rol, activo, unidad_id)
select u.id, u.raw_user_meta_data->>'nombre', u.email,
       case u.email when 'a@dimelco.test' then 'admin' when 'i@dimelco.test' then 'invitado' else 'capturador' end,
       u.email <> 'i@dimelco.test',
       case u.email when 'a@dimelco.test' then null when 'c@dimelco.test' then (select id from unidades where nombre='HEMCO')
                    when 'v@dimelco.test' then (select id from unidades where nombre='Veta Nueva') else (select id from unidades where nombre='Explotec') end
from auth.users u;
SQL

# Backlog: mismo esquema auth, base local y migraciones.
P -d back -c "$AUTH"
P -d back -f "$RAIZ/tools/base_local.sql"
for f in "$RAIZ"/supabase/migrations/*.sql; do P -d back -f "$f"; done

P -d prev -At -f "$RAIZ/tools/exportar_usuarios_preventivos.sql" > "$DIR/copia.sql"
echo "script generado: $(wc -l < "$DIR/copia.sql") líneas"
P -d back -f "$DIR/copia.sql" > /dev/null
P -d back -f "$DIR/copia.sql" > /dev/null   # repetir no duplica ni falla

esperado="Ana Admin|admin|t||Carlos Capturador|capturador|t|HEMCO|Inés Invitada|invitado|f|Explotec|Vera O'Brien|capturador|t|Veta Nueva"
obtenido=$(P -d back -At -F'|' -c "select p.nombre, p.rol, p.activo, coalesce(u.nombre,'') from perfiles p left join unidades u on u.id = p.unidad_id order by p.nombre" | tr '\n' '|' | sed 's/|$//' | sed 's/|\([A-Z]\)/|\1/g')
python3 - "$esperado" "$obtenido" <<'PY'
import sys
e=[x for x in sys.argv[1].split("|")]; o=[x for x in sys.argv[2].split("|")]
if e!=o: sys.exit(f"Perfiles distintos:\n esperado {e}\n obtenido {o}")
PY
echo "perfiles: nombre, rol, activo y unidad iguales a preventivos"
n=$(P -d back -At -c "select count(*) from auth.users"); i=$(P -d back -At -c "select count(*) from auth.identities")
[ "$n" = 4 ] && [ "$i" = 4 ] || { echo "Usuarios $n, identidades $i (esperado 4 y 4)"; exit 1; }
# Las contraseñas cifradas son idénticas y la clave de Ana sigue sirviendo en backlog.
dif=$(P -d back -At -c "select count(*) from auth.users b join dblink('dbname=prev port=$PUERTO host=$DIR user=postgres','select id, encrypted_password from auth.users') a(id uuid, h text) on a.id=b.id where a.h <> b.encrypted_password" 2>/dev/null || echo "sin-dblink")
if [ "$dif" = "sin-dblink" ]; then
  ok=$(P -d back -At -c "select encrypted_password = crypt('clave-ana', encrypted_password) from auth.users where email='a@dimelco.test'")
else
  ok=$([ "$dif" = 0 ] && echo t || echo f)
fi
[ "$ok" = t ] || { echo "La contraseña no se conservó"; exit 1; }
echo "4 usuarios y 4 identidades; la contraseña de cada uno sigue válida"
echo "PRUEBA USUARIOS OK"
