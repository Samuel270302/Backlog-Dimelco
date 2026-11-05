-- Catálogos: equipos (importados una vez desde preventivos), sistemas, especialidades
-- y capacidad del taller en HH por semana.

create table if not exists equipos (
  id           uuid primary key default gen_random_uuid(),
  unidad_id    uuid not null references unidades(id),
  cod_interno  text not null,          -- Scooptram #1, Boomer #2...
  cod_sap      text,
  modelo       text not null,
  flota        text,                   -- Scooptram, Jumbo, Empernador, Camión...
  activo       boolean not null default true,
  creado_en    timestamptz not null default now(),
  constraint equipos_unidad_cod_interno_key unique (unidad_id, cod_interno)
);
create index if not exists equipos_unidad on equipos (unidad_id);

create table if not exists sistemas (
  id      uuid primary key default gen_random_uuid(),
  nombre  text not null unique,
  activo  boolean not null default true,
  orden   integer not null default 0
);
insert into sistemas (nombre, orden) values
  ('Motor', 1), ('Transmisión', 2), ('Sistema hidráulico', 3), ('Sistema eléctrico', 4),
  ('Frenos', 5), ('Dirección', 6), ('Estructura y chasis', 7), ('Neumáticos', 8),
  ('Perforadora', 9), ('Empernadora', 10), ('Compresor', 11), ('Cabina y seguridad', 12),
  ('Otro', 99)
on conflict (nombre) do nothing;

create table if not exists especialidades (
  id      uuid primary key default gen_random_uuid(),
  nombre  text not null unique,
  activo  boolean not null default true,
  orden   integer not null default 0
);
insert into especialidades (nombre, orden) values
  ('Mecánico', 1), ('Eléctrico', 2), ('Hidráulico', 3), ('Soldador', 4), ('Llantero', 5)
on conflict (nombre) do nothing;

-- Capacidad disponible por unidad y especialidad. La vigente es la de mayor
-- vigente_desde que no pasa de hoy(); un cambio de dotación se carga como fila nueva.
create table if not exists capacidad_taller (
  id               uuid primary key default gen_random_uuid(),
  unidad_id        uuid not null references unidades(id),
  especialidad_id  uuid not null references especialidades(id),
  hh_semana        numeric not null check (hh_semana >= 0),
  vigente_desde    date not null default current_date,
  creado_en        timestamptz not null default now(),
  unique (unidad_id, especialidad_id, vigente_desde)
);
