-- Base de la app de backlog: unidades, perfiles, parámetros y funciones de sesión.
-- Proyecto Supabase propio, separado del de preventivos.

create table if not exists unidades (
  id      uuid primary key default gen_random_uuid(),
  nombre  text not null unique,
  sigla   text not null unique check (sigla ~ '^[A-Z]{3}$'),  -- va en el folio: BL-HEM-000123
  activo  boolean not null default true,
  orden   integer not null default 0
);
insert into unidades (nombre, sigla, orden) values
  ('HEMCO', 'HEM', 1), ('Veta Nueva', 'VTN', 2), ('Mina La India', 'MLI', 3), ('Explotec', 'EXP', 4)
on conflict (nombre) do nothing;

-- Los perfiles nuevos nacen inactivos y sin unidad; el admin los activa en Usuarios.
create table if not exists perfiles (
  user_id    uuid primary key,
  nombre     text not null,
  correo     text,
  rol        text not null default 'capturador' check (rol in ('admin', 'capturador', 'invitado')),
  activo     boolean not null default false,
  unidad_id  uuid references unidades(id),
  creado_en  timestamptz not null default now(),
  constraint perfiles_unidad_requerida check (rol = 'admin' or not activo or unidad_id is not null)
);

create table if not exists parametros (
  clave        text primary key,
  valor        numeric,
  valor_texto  text,
  descripcion  text
);

-- Plazos provisionales: se reemplazan por los de HEMCO en la pantalla de parámetros.
insert into parametros (clave, valor, descripcion) values
  ('plazo_p1_dias',  2, 'Días para atender un backlog P1 desde su detección (provisional)'),
  ('plazo_p2_dias',  7, 'Días para atender un backlog P2 desde su detección (provisional)'),
  ('plazo_p3_dias', 30, 'Días para atender un backlog P3 desde su detección (provisional)'),
  ('plazo_p4_dias', 90, 'Días para atender un backlog P4 desde su detección (provisional)')
on conflict (clave) do nothing;
insert into parametros (clave, valor, valor_texto, descripcion) values
  ('fecha_referencia', null, null, 'Solo pruebas: fija el «hoy» de las vistas (YYYY-MM-DD). Vacío = fecha actual')
on conflict (clave) do nothing;

create or replace function hoy() returns date
language sql stable as $$
  select coalesce(
    (select nullif(valor_texto, '')::date from parametros where clave = 'fecha_referencia'),
    current_date)
$$;

create or replace function param(p_clave text) returns numeric
language sql stable as $$
  select valor from parametros where clave = p_clave
$$;

-- Usuario de la sesión tomado del token (lo mismo que auth.uid()); así las funciones
-- también corren en una base local de pruebas sin el esquema auth.
create or replace function usuario_sesion() returns uuid
language sql stable as $$
  select nullif(coalesce(current_setting('request.jwt.claim.sub', true),
                         nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'), '')::uuid
$$;

create or replace function rol_actual() returns text
language sql stable security definer set search_path = public as $$
  select rol from perfiles where user_id = usuario_sesion() and activo
$$;

create or replace function unidad_actual() returns uuid
language sql stable security definer set search_path = public as $$
  select unidad_id from perfiles where user_id = usuario_sesion() and activo
$$;

-- El admin ve y graba en todas las unidades; capturador e invitado, solo en la suya.
create or replace function unidad_permitida(p_unidad uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(rol_actual() = 'admin', false)
      or (p_unidad is not null and p_unidad = unidad_actual())
$$;
