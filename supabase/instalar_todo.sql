-- Instalación completa de la base de backlog (generado por tools/armar_instalacion.sh).
-- Pegar todo en el SQL Editor del proyecto Supabase NUEVO y ejecutar. Se puede repetir.

-- ===== 001_base.sql =====
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

-- ===== 002_catalogos.sql =====
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

-- ===== 003_backlog.sql =====
-- Backlog: trabajos pendientes de equipo, con HH por especialidad, repuestos,
-- bitácora y fotos. Nada se borra físico: un backlog se rechaza o anula con motivo.

create table if not exists backlogs (
  id                 uuid primary key default gen_random_uuid(),
  folio              text not null unique,                 -- BL-HEM-000123, lo pone el disparador
  unidad_id          uuid not null references unidades(id),-- la del equipo, la pone el disparador
  equipo_id          uuid not null references equipos(id),
  sistema_id         uuid not null references sistemas(id),
  descripcion        text not null check (length(trim(descripcion)) >= 5),
  origen             text not null check (origen in
                       ('Inspección','PM','Operador','Falla','Análisis de aceite','Otro')),
  prioridad          text not null check (prioridad in ('P1','P2','P3','P4')),
  estado             text not null default 'Identificado' check (estado in
                       ('Identificado','En planificación','Esperando repuestos','Listo para programar',
                        'Programado','Ejecutado','Cerrado','Rechazado','Anulado')),
  fecha_deteccion    date not null default hoy(),
  fecha_limite       date,                                 -- detección + plazo de la prioridad
  reportado_por      text,                                 -- quien vio el hallazgo (puede no tener usuario)
  aviso_sap          text,
  ot_sap             text,
  semana_programada  date,                                 -- lunes de la semana
  fecha_programada   date,
  aprovechar_pm      boolean not null default false,
  fecha_ejecucion    date,
  reprogramaciones   integer not null default 0,
  motivo_anulacion   text,
  creado_por         uuid default usuario_sesion(),
  creado_en          timestamptz not null default now(),
  actualizado_en     timestamptz not null default now(),
  constraint backlogs_semana_lunes check (semana_programada is null or extract(isodow from semana_programada) = 1)
);
create index if not exists backlogs_unidad_estado on backlogs (unidad_id, estado);
create index if not exists backlogs_equipo on backlogs (equipo_id);

-- Correlativo de folio por unidad.
create table if not exists folios (
  unidad_id  uuid primary key references unidades(id),
  ultimo     integer not null default 0
);

create table if not exists backlog_hh (
  id               uuid primary key default gen_random_uuid(),
  backlog_id       uuid not null references backlogs(id),
  especialidad_id  uuid not null references especialidades(id),
  tipo             text not null check (tipo in ('estimada','real')),
  personas         numeric not null check (personas > 0),
  horas            numeric not null check (horas > 0),
  hh               numeric generated always as (personas * horas) stored,
  creado_por       uuid default usuario_sesion(),
  creado_en        timestamptz not null default now(),
  unique (backlog_id, especialidad_id, tipo)
);

create table if not exists backlog_repuestos (
  id              uuid primary key default gen_random_uuid(),
  backlog_id      uuid not null references backlogs(id),
  cod_sap         text not null check (length(trim(cod_sap)) > 0),
  descripcion     text,
  cantidad        numeric not null check (cantidad > 0),
  um              text not null default 'UN',
  solicitud_sap   text,                                    -- SolPed o reserva
  estado          text not null default 'Por pedir' check (estado in ('Por pedir','Pedido','Recibido')),
  fecha_estimada  date,
  fecha_recibido  date,
  creado_por      uuid default usuario_sesion(),
  creado_en       timestamptz not null default now()
);
create index if not exists backlog_repuestos_backlog on backlog_repuestos (backlog_id);

create table if not exists backlog_eventos (
  id               uuid primary key default gen_random_uuid(),
  backlog_id       uuid not null references backlogs(id),
  tipo             text not null check (tipo in ('estado','comentario','repuesto','reprogramación')),
  estado_anterior  text,
  estado_nuevo     text,
  texto            text,
  usuario          uuid default usuario_sesion(),
  creado_en        timestamptz not null default now()
);
create index if not exists backlog_eventos_backlog on backlog_eventos (backlog_id, creado_en);

-- Ruta en Storage: <unidad_id>/<backlog_id>/<archivo>.jpg (bucket backlog-fotos).
create table if not exists backlog_fotos (
  id          uuid primary key default gen_random_uuid(),
  backlog_id  uuid not null references backlogs(id),
  ruta        text not null unique,
  creado_por  uuid default usuario_sesion(),
  creado_en   timestamptz not null default now()
);

create or replace function plazo_prioridad(p_prioridad text) returns integer
language sql stable as $$
  select param('plazo_' || lower(p_prioridad) || '_dias')::integer
$$;

-- Alta: unidad del equipo, folio correlativo, plazo, estado inicial y evento de registro.
create or replace function tg_backlog_alta() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_sigla text;
  v_num   integer;
begin
  select e.unidad_id, u.sigla into new.unidad_id, v_sigla
  from equipos e join unidades u on u.id = e.unidad_id
  where e.id = new.equipo_id;
  if new.unidad_id is null then
    raise exception 'Equipo inexistente';
  end if;
  if new.fecha_deteccion > hoy() then
    raise exception 'La fecha de detección no puede ser futura';
  end if;
  insert into folios (unidad_id, ultimo) values (new.unidad_id, 1)
  on conflict (unidad_id) do update set ultimo = folios.ultimo + 1
  returning ultimo into v_num;
  new.folio := format('BL-%s-%s', v_sigla, lpad(v_num::text, 6, '0'));
  new.estado := 'Identificado';
  new.fecha_limite := new.fecha_deteccion + plazo_prioridad(new.prioridad);
  new.reprogramaciones := 0;
  new.creado_en := now();
  new.actualizado_en := now();
  return new;
end $$;

drop trigger if exists backlog_alta on backlogs;
create trigger backlog_alta before insert on backlogs
  for each row execute function tg_backlog_alta();

create or replace function tg_backlog_evento_alta() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into backlog_eventos (backlog_id, tipo, estado_nuevo, texto, usuario)
  values (new.id, 'estado', new.estado, 'Registrado', new.creado_por);
  return null;
end $$;

drop trigger if exists backlog_evento_alta on backlogs;
create trigger backlog_evento_alta after insert on backlogs
  for each row execute function tg_backlog_evento_alta();

-- Cambios: el estado y los campos que lo acompañan solo los mueve
-- cambiar_estado_backlog(); folio, unidad y equipo no cambian; cerrados no se editan.
create or replace function tg_backlog_cambio() returns trigger
language plpgsql as $$
declare
  v_transicion boolean := coalesce(current_setting('backlog.transicion', true), '') = 'si';
begin
  if new.folio <> old.folio or new.unidad_id <> old.unidad_id or new.creado_por is distinct from old.creado_por then
    raise exception 'El folio, la unidad y el autor de un backlog no se cambian';
  end if;
  if new.equipo_id <> old.equipo_id then
    if old.estado <> 'Identificado' then
      raise exception 'El equipo solo se corrige mientras el backlog está Identificado';
    end if;
    if (select unidad_id from equipos where id = new.equipo_id) <> old.unidad_id then
      raise exception 'El equipo nuevo es de otra unidad';
    end if;
  end if;
  if not v_transicion then
    if old.estado in ('Cerrado','Rechazado','Anulado') then
      raise exception 'Backlog % en estado %: no se edita', old.folio, old.estado;
    end if;
    if new.estado <> old.estado
       or new.reprogramaciones <> old.reprogramaciones
       or new.motivo_anulacion is distinct from old.motivo_anulacion
       or new.fecha_ejecucion is distinct from old.fecha_ejecucion
       or new.semana_programada is distinct from old.semana_programada
       or new.fecha_programada is distinct from old.fecha_programada then
      raise exception 'El estado y la programación se cambian con cambiar_estado_backlog()';
    end if;
  end if;
  if new.prioridad <> old.prioridad or new.fecha_deteccion <> old.fecha_deteccion then
    new.fecha_limite := new.fecha_deteccion + plazo_prioridad(new.prioridad);
  end if;
  new.actualizado_en := now();
  return new;
end $$;

drop trigger if exists backlog_cambio on backlogs;
create trigger backlog_cambio before update on backlogs
  for each row execute function tg_backlog_cambio();

-- Detalle (HH, repuestos, fotos): no se toca cuando el backlog está cerrado,
-- rechazado o anulado. Las HH reales se cargan en Programado o Ejecutado.
create or replace function tg_detalle_editable() returns trigger
language plpgsql as $$
declare
  v_fila    record;
  v_estado  text;
begin
  if tg_op = 'DELETE' then v_fila := old; else v_fila := new; end if;
  select estado into v_estado from backlogs where id = v_fila.backlog_id;
  if v_estado in ('Cerrado','Rechazado','Anulado') then
    raise exception 'El backlog está %: su detalle no se edita', v_estado;
  end if;
  if tg_table_name = 'backlog_hh' then
    if v_fila.tipo = 'real' and v_estado not in ('Programado','Ejecutado') then
      raise exception 'Las HH reales se cargan con el backlog Programado o Ejecutado';
    end if;
    if v_fila.tipo = 'estimada' and v_estado in ('Ejecutado') then
      raise exception 'Con el backlog Ejecutado ya no se cambian las HH estimadas';
    end if;
  end if;
  if tg_table_name = 'backlog_repuestos' and tg_op <> 'DELETE' then
    if new.estado = 'Recibido' and new.fecha_recibido is null then
      new.fecha_recibido := current_date;
    elsif new.estado <> 'Recibido' then
      new.fecha_recibido := null;
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['backlog_hh','backlog_repuestos','backlog_fotos'] loop
    execute format('drop trigger if exists detalle_editable on %I', t);
    execute format('create trigger detalle_editable before insert or update or delete on %I
                    for each row execute function tg_detalle_editable()', t);
  end loop;
end $$;

-- ===== 004_transiciones.sql =====
-- Flujo del backlog. El estado solo cambia por esta función, que revisa rol,
-- unidad, transición permitida y datos obligatorios, y deja el evento en la bitácora.
--
--   Identificado         -> En planificación (admin: HH estimadas cargadas) | Rechazado (admin, motivo)
--   En planificación     -> Esperando repuestos (admin: hay repuestos sin recibir)
--                         | Listo para programar (admin: sin repuestos o todos recibidos)
--   Esperando repuestos  -> Listo para programar (automático al recibir el último, o admin)
--                         | En planificación (admin)
--   Listo para programar -> Programado (admin: semana, fecha y OT) | En planificación (admin)
--   Programado           -> Ejecutado (admin o capturador: fecha y HH reales)
--                         | Listo para programar (admin, motivo: reprogramación)
--   Ejecutado            -> Cerrado (admin)
--   Cualquier estado abierto -> Anulado (admin, motivo)
--
-- p_datos (jsonb, todo opcional salvo lo que pida la transición):
--   prioridad, motivo, comentario, semana_programada, fecha_programada, ot_sap,
--   aprovechar_pm, fecha_ejecucion

create or replace function cambiar_estado_backlog(p_id uuid, p_estado text, p_datos jsonb default '{}'::jsonb)
returns backlogs
language plpgsql security definer set search_path = public as $$
declare
  b          backlogs;
  v_rol      text := rol_actual();
  v_motivo   text := nullif(trim(p_datos->>'motivo'), '');
  v_coment   text := nullif(trim(p_datos->>'comentario'), '');
  v_tipo_ev  text := 'estado';
  v_pend     integer;
  v_total    integer;
  v_fecha    date;
  v_semana   date;
  v_anterior text;
begin
  select * into b from backlogs where id = p_id for update;
  if not found then
    raise exception 'Backlog inexistente';
  end if;
  v_anterior := b.estado;
  if v_rol is null or v_rol = 'invitado' or not unidad_permitida(b.unidad_id) then
    raise exception 'Sin permiso para cambiar este backlog';
  end if;
  if p_estado = b.estado then
    raise exception 'El backlog ya está %', b.estado;
  end if;

  select count(*), count(*) filter (where estado <> 'Recibido')
    into v_total, v_pend
  from backlog_repuestos where backlog_id = b.id;

  -- Transiciones permitidas y quién las hace
  if not (
       (b.estado = 'Identificado'         and p_estado in ('En planificación','Rechazado'))
    or (b.estado = 'En planificación'     and p_estado in ('Esperando repuestos','Listo para programar'))
    or (b.estado = 'Esperando repuestos'  and p_estado in ('Listo para programar','En planificación'))
    or (b.estado = 'Listo para programar' and p_estado in ('Programado','En planificación'))
    or (b.estado = 'Programado'           and p_estado in ('Ejecutado','Listo para programar'))
    or (b.estado = 'Ejecutado'            and p_estado = 'Cerrado')
    or (b.estado in ('Identificado','En planificación','Esperando repuestos','Listo para programar','Programado')
        and p_estado = 'Anulado')
  ) then
    raise exception 'No se puede pasar de % a %', b.estado, p_estado;
  end if;
  if v_rol <> 'admin' and not (b.estado = 'Programado' and p_estado = 'Ejecutado') then
    raise exception 'Solo el administrador puede pasar de % a %', b.estado, p_estado;
  end if;

  perform set_config('backlog.transicion', 'si', true);

  if p_datos ? 'prioridad' and b.estado in ('Identificado','En planificación') then
    b.prioridad := p_datos->>'prioridad';
  end if;

  case p_estado
    when 'En planificación' then
      if b.estado = 'Identificado'
         and not exists (select 1 from backlog_hh where backlog_id = b.id and tipo = 'estimada') then
        raise exception 'Cargue las HH estimadas por especialidad antes de planificar';
      end if;
    when 'Esperando repuestos' then
      if v_pend = 0 then
        raise exception 'No hay repuestos pendientes de recibir';
      end if;
    when 'Listo para programar' then
      if v_pend > 0 then
        raise exception 'Faltan % repuesto(s) por recibir', v_pend;
      end if;
      if b.estado = 'Programado' then
        if v_motivo is null then
          raise exception 'Indique el motivo de la reprogramación';
        end if;
        b.reprogramaciones := b.reprogramaciones + 1;
        b.semana_programada := null;
        b.fecha_programada := null;
        v_tipo_ev := 'reprogramación';
      end if;
    when 'Programado' then
      v_fecha := coalesce((p_datos->>'fecha_programada')::date, b.fecha_programada);
      v_semana := coalesce((p_datos->>'semana_programada')::date, date_trunc('week', v_fecha)::date);
      b.ot_sap := coalesce(nullif(trim(p_datos->>'ot_sap'), ''), b.ot_sap);
      if v_fecha is null or b.ot_sap is null then
        raise exception 'Para programar indique fecha programada y OT SAP';
      end if;
      if v_fecha < hoy() then
        raise exception 'La fecha programada no puede ser pasada';
      end if;
      if date_trunc('week', v_fecha)::date <> v_semana then
        raise exception 'La fecha programada no cae en la semana indicada';
      end if;
      b.fecha_programada := v_fecha;
      b.semana_programada := v_semana;
      b.aprovechar_pm := coalesce((p_datos->>'aprovechar_pm')::boolean, b.aprovechar_pm);
    when 'Ejecutado' then
      v_fecha := (p_datos->>'fecha_ejecucion')::date;
      if v_fecha is null then
        raise exception 'Indique la fecha de ejecución';
      end if;
      if v_fecha > hoy() then
        raise exception 'La fecha de ejecución no puede ser futura';
      end if;
      if not exists (select 1 from backlog_hh where backlog_id = b.id and tipo = 'real') then
        raise exception 'Cargue las HH reales por especialidad antes de marcar ejecutado';
      end if;
      b.fecha_ejecucion := v_fecha;
    when 'Rechazado', 'Anulado' then
      if v_motivo is null then
        raise exception 'Indique el motivo';
      end if;
      b.motivo_anulacion := v_motivo;
    else
      null;
  end case;

  update backlogs set
    estado = p_estado,
    prioridad = b.prioridad,
    ot_sap = b.ot_sap,
    semana_programada = b.semana_programada,
    fecha_programada = b.fecha_programada,
    aprovechar_pm = b.aprovechar_pm,
    fecha_ejecucion = b.fecha_ejecucion,
    reprogramaciones = b.reprogramaciones,
    motivo_anulacion = b.motivo_anulacion
  where id = b.id
  returning * into b;

  insert into backlog_eventos (backlog_id, tipo, estado_anterior, estado_nuevo, texto)
  values (b.id, v_tipo_ev, v_anterior, p_estado, nullif(concat_ws(' · ', v_motivo, v_coment), ''));

  perform set_config('backlog.transicion', 'no', true);
  return b;
end $$;

-- Repuestos: al recibir el último, el backlog en Esperando repuestos pasa solo a
-- Listo para programar; si a uno Listo se le agrega un repuesto sin recibir, vuelve a esperar.
create or replace function tg_repuestos_estado() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_id     uuid := coalesce(new.backlog_id, old.backlog_id);
  v_estado text;
  v_pend   integer;
  v_total  integer;
  v_nuevo  text;
begin
  select estado into v_estado from backlogs where id = v_id;
  select count(*), count(*) filter (where estado <> 'Recibido') into v_total, v_pend
  from backlog_repuestos where backlog_id = v_id;
  if v_estado = 'Esperando repuestos' and v_total > 0 and v_pend = 0 then
    v_nuevo := 'Listo para programar';
  elsif v_estado = 'Listo para programar' and v_pend > 0 then
    v_nuevo := 'Esperando repuestos';
  end if;
  if v_nuevo is not null then
    perform set_config('backlog.transicion', 'si', true);
    update backlogs set estado = v_nuevo where id = v_id;
    perform set_config('backlog.transicion', 'no', true);
    insert into backlog_eventos (backlog_id, tipo, estado_anterior, estado_nuevo, texto)
    values (v_id, 'estado', v_estado, v_nuevo,
            case when v_pend = 0 then 'Automático: todos los repuestos recibidos'
                 else 'Automático: se agregó un repuesto sin recibir' end);
  end if;
  return null;
end $$;

drop trigger if exists repuestos_estado on backlog_repuestos;
create trigger repuestos_estado after insert or update or delete on backlog_repuestos
  for each row execute function tg_repuestos_estado();

-- ===== 005_vistas.sql =====
-- Vistas del tablero, la programación y los indicadores. Respetan las políticas
-- de las tablas base (security_invoker) en Supabase.

-- Se borra y se recrea: usa b.* y 008 le agrega columnas a backlogs.
drop view if exists v_backlog;
create view v_backlog as
with hh as (
  select backlog_id,
         sum(hh) filter (where tipo = 'estimada') as hh_estimadas,
         sum(hh) filter (where tipo = 'real')     as hh_reales
  from backlog_hh group by backlog_id
),
rep as (
  select backlog_id,
         count(*) as repuestos_total,
         count(*) filter (where estado <> 'Recibido') as repuestos_pendientes
  from backlog_repuestos group by backlog_id
)
select b.*,
       e.cod_interno, e.modelo, e.flota,
       s.nombre as sistema,
       case when b.estado in ('Ejecutado','Cerrado') then coalesce(b.fecha_ejecucion, hoy()) - b.fecha_deteccion
            else hoy() - b.fecha_deteccion end as antiguedad_dias,
       case when b.estado in ('Ejecutado','Cerrado','Rechazado','Anulado') then null
            else b.fecha_limite - hoy() end as dias_para_limite,
       (b.estado not in ('Ejecutado','Cerrado','Rechazado','Anulado') and b.fecha_limite < hoy()) as vencido,
       coalesce(hh.hh_estimadas, 0) as hh_estimadas,
       coalesce(hh.hh_reales, 0)    as hh_reales,
       coalesce(rep.repuestos_total, 0)      as repuestos_total,
       coalesce(rep.repuestos_pendientes, 0) as repuestos_pendientes
from backlogs b
join equipos e  on e.id = b.equipo_id
join sistemas s on s.id = b.sistema_id
left join hh  on hh.backlog_id = b.id
left join rep on rep.backlog_id = b.id;

-- HH estimadas de los backlogs abiertos (sin ejecutar), por unidad y especialidad.
create or replace view v_hh_pendiente as
select b.unidad_id, h.especialidad_id, b.estado, sum(h.hh) as hh
from backlogs b
join backlog_hh h on h.backlog_id = b.id and h.tipo = 'estimada'
where b.estado in ('Identificado','En planificación','Esperando repuestos','Listo para programar','Programado')
group by b.unidad_id, h.especialidad_id, b.estado;

-- Capacidad vigente a hoy() por unidad y especialidad.
create or replace view v_capacidad_vigente as
select distinct on (unidad_id, especialidad_id)
       unidad_id, especialidad_id, hh_semana, vigente_desde
from capacidad_taller
where vigente_desde <= hoy()
order by unidad_id, especialidad_id, vigente_desde desc;

-- Semanas de backlog = HH pendientes / HH disponibles por semana.
create or replace view v_semanas_backlog as
with pend as (
  select unidad_id, especialidad_id, sum(hh) as hh_pendientes
  from v_hh_pendiente group by unidad_id, especialidad_id
)
select coalesce(p.unidad_id, c.unidad_id) as unidad_id,
       coalesce(p.especialidad_id, c.especialidad_id) as especialidad_id,
       es.nombre as especialidad,
       coalesce(p.hh_pendientes, 0) as hh_pendientes,
       c.hh_semana,
       case when c.hh_semana > 0 then round(coalesce(p.hh_pendientes, 0) / c.hh_semana, 2) end as semanas
from pend p
full join v_capacidad_vigente c on c.unidad_id = p.unidad_id and c.especialidad_id = p.especialidad_id
join especialidades es on es.id = coalesce(p.especialidad_id, c.especialidad_id);

-- HH programadas por semana, unidad y especialidad (para comparar con la capacidad).
create or replace view v_carga_semanal as
select b.unidad_id, b.semana_programada as semana, h.especialidad_id, sum(h.hh) as hh_programadas,
       count(distinct b.id) as backlogs
from backlogs b
join backlog_hh h on h.backlog_id = b.id and h.tipo = 'estimada'
where b.estado = 'Programado'
group by b.unidad_id, b.semana_programada, h.especialidad_id;

-- Ingresos y cierres por semana ISO (lunes). Cierre = ejecutado (fecha de ejecución).
create or replace view v_backlog_semanal as
with ing as (
  select unidad_id, date_trunc('week', fecha_deteccion)::date as semana,
         count(*) as ingresos,
         count(*) filter (where estado not in ('Rechazado','Anulado')) as ingresos_validos
  from backlogs group by 1, 2
),
cie as (
  select unidad_id, date_trunc('week', fecha_ejecucion)::date as semana,
         count(*) as cierres,
         count(*) filter (where fecha_ejecucion <= fecha_limite) as cierres_en_plazo
  from backlogs
  where estado in ('Ejecutado','Cerrado') and fecha_ejecucion is not null
  group by 1, 2
)
select coalesce(i.unidad_id, c.unidad_id) as unidad_id,
       coalesce(i.semana, c.semana) as semana,
       coalesce(i.ingresos, 0) as ingresos,
       coalesce(i.ingresos_validos, 0) as ingresos_validos,
       coalesce(c.cierres, 0) as cierres,
       coalesce(c.cierres_en_plazo, 0) as cierres_en_plazo
from ing i
full join cie c on c.unidad_id = i.unidad_id and c.semana = i.semana;

do $$
declare v text;
begin
  foreach v in array array['v_backlog','v_hh_pendiente','v_capacidad_vigente','v_semanas_backlog',
                           'v_carga_semanal','v_backlog_semanal'] loop
    execute format('alter view %I set (security_invoker = true)', v);
  end loop;
end $$;

-- ===== 006_rls.sql =====
-- Seguridad por rol y unidad.
--   admin:      todo, en todas las unidades.
--   capturador: registra backlogs, HH, repuestos, fotos y comentarios de su unidad;
--               edita el backlog mientras está Identificado; marca Ejecutado.
--   invitado:   solo consulta su unidad.
-- Las transiciones de estado van por cambiar_estado_backlog() (004).

create or replace function unidad_de_backlog(p_backlog uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select unidad_id from backlogs where id = p_backlog
$$;

revoke execute on function rol_actual(), unidad_actual(), unidad_permitida(uuid),
  unidad_de_backlog(uuid), cambiar_estado_backlog(uuid, text, jsonb) from public;
grant execute on function rol_actual(), unidad_actual(), unidad_permitida(uuid),
  unidad_de_backlog(uuid), cambiar_estado_backlog(uuid, text, jsonb) to authenticated;

do $$
declare t text;
begin
  foreach t in array array['unidades','perfiles','parametros','equipos','sistemas','especialidades',
                           'capacidad_taller','backlogs','folios','backlog_hh','backlog_repuestos',
                           'backlog_eventos','backlog_fotos'] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- Catálogos generales: los lee cualquier usuario activo, los administra el admin.
do $$
declare t text;
begin
  foreach t in array array['unidades','parametros','sistemas','especialidades'] loop
    execute format('drop policy if exists leer_%I on %I', t, t);
    execute format('create policy leer_%I on %I for select to authenticated
                    using (rol_actual() is not null)', t, t);
    execute format('drop policy if exists administrar_%I on %I', t, t);
    execute format('create policy administrar_%I on %I for all to authenticated
                    using (rol_actual() = ''admin'') with check (rol_actual() = ''admin'')', t, t);
  end loop;
end $$;

-- Perfiles: cada uno lee el suyo aunque esté inactivo (pantalla de acceso pendiente).
drop policy if exists leer_perfiles on perfiles;
create policy leer_perfiles on perfiles for select to authenticated
  using (rol_actual() is not null or user_id = usuario_sesion());
drop policy if exists administrar_perfiles on perfiles;
create policy administrar_perfiles on perfiles for all to authenticated
  using (rol_actual() = 'admin') with check (rol_actual() = 'admin');

-- Equipos y capacidad: por unidad; los administra el admin.
do $$
declare t text;
begin
  foreach t in array array['equipos','capacidad_taller'] loop
    execute format('drop policy if exists leer_%I on %I', t, t);
    execute format('create policy leer_%I on %I for select to authenticated
                    using (rol_actual() is not null and unidad_permitida(unidad_id))', t, t);
    execute format('drop policy if exists administrar_%I on %I', t, t);
    execute format('create policy administrar_%I on %I for all to authenticated
                    using (rol_actual() = ''admin'') with check (rol_actual() = ''admin'')', t, t);
  end loop;
end $$;

-- Backlogs. Sin política de borrado: no se borran.
drop policy if exists leer_backlogs on backlogs;
create policy leer_backlogs on backlogs for select to authenticated
  using (rol_actual() is not null and unidad_permitida(unidad_id));
drop policy if exists registrar_backlogs on backlogs;
create policy registrar_backlogs on backlogs for insert to authenticated
  with check (rol_actual() in ('admin','capturador') and unidad_permitida(unidad_id));
drop policy if exists editar_backlogs on backlogs;
create policy editar_backlogs on backlogs for update to authenticated
  using (unidad_permitida(unidad_id)
         and (rol_actual() = 'admin' or (rol_actual() = 'capturador' and estado = 'Identificado')))
  with check (unidad_permitida(unidad_id));

-- Detalle del backlog: lo leen todos los de la unidad; lo editan admin y capturador.
do $$
declare t text;
begin
  foreach t in array array['backlog_hh','backlog_repuestos','backlog_fotos'] loop
    execute format('drop policy if exists leer_%I on %I', t, t);
    execute format('create policy leer_%I on %I for select to authenticated
                    using (rol_actual() is not null and unidad_permitida(unidad_de_backlog(backlog_id)))', t, t);
    execute format('drop policy if exists editar_%I on %I', t, t);
    execute format('create policy editar_%I on %I for all to authenticated
                    using (rol_actual() in (''admin'',''capturador'') and unidad_permitida(unidad_de_backlog(backlog_id)))
                    with check (rol_actual() in (''admin'',''capturador'') and unidad_permitida(unidad_de_backlog(backlog_id)))', t, t);
  end loop;
end $$;

-- Bitácora: desde la app solo se agregan comentarios propios; los eventos de estado
-- los escriben las funciones de la base.
drop policy if exists leer_backlog_eventos on backlog_eventos;
create policy leer_backlog_eventos on backlog_eventos for select to authenticated
  using (rol_actual() is not null and unidad_permitida(unidad_de_backlog(backlog_id)));
drop policy if exists comentar_backlog_eventos on backlog_eventos;
create policy comentar_backlog_eventos on backlog_eventos for insert to authenticated
  with check (rol_actual() in ('admin','capturador')
              and unidad_permitida(unidad_de_backlog(backlog_id))
              and tipo = 'comentario' and usuario = usuario_sesion()
              and estado_anterior is null and estado_nuevo is null);

-- Perfil automático (inactivo, sin unidad) al crear un usuario en Authentication.
create or replace function crear_perfil() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into perfiles (user_id, nombre, correo, rol, activo)
  values (new.id, coalesce(new.raw_user_meta_data->>'nombre', split_part(new.email, '@', 1)),
          new.email, 'capturador', false)
  on conflict (user_id) do nothing;
  return new;
end $$;

do $$
begin
  if to_regclass('auth.users') is not null then
    drop trigger if exists al_crear_usuario on auth.users;
    create trigger al_crear_usuario after insert on auth.users
      for each row execute function crear_perfil();
  end if;
end $$;

-- Tiempo real de Supabase.
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['backlogs','backlog_hh','backlog_repuestos','backlog_eventos','backlog_fotos',
                             'equipos','sistemas','especialidades','capacidad_taller','parametros','perfiles'] loop
      if not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table %I', t);
      end if;
    end loop;
  end if;
end $$;

-- ===== 007_storage.sql =====
-- Fotos de backlog en Supabase Storage: bucket privado backlog-fotos.
-- Ruta: <unidad_id>/<backlog_id>/<archivo>.jpg; la carpeta raíz decide la unidad.

do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'Sin esquema storage: se omite 007 (base local)';
    return;
  end if;

  insert into storage.buckets (id, name, public)
  values ('backlog-fotos', 'backlog-fotos', false)
  on conflict (id) do nothing;

  drop policy if exists leer_backlog_fotos on storage.objects;
  create policy leer_backlog_fotos on storage.objects for select to authenticated
    using (bucket_id = 'backlog-fotos' and rol_actual() is not null
           and unidad_permitida(((storage.foldername(name))[1])::uuid));

  drop policy if exists subir_backlog_fotos on storage.objects;
  create policy subir_backlog_fotos on storage.objects for insert to authenticated
    with check (bucket_id = 'backlog-fotos' and rol_actual() in ('admin','capturador')
                and unidad_permitida(((storage.foldername(name))[1])::uuid)
                and unidad_de_backlog(((storage.foldername(name))[2])::uuid) = ((storage.foldername(name))[1])::uuid);

  drop policy if exists borrar_backlog_fotos on storage.objects;
  create policy borrar_backlog_fotos on storage.objects for delete to authenticated
    using (bucket_id = 'backlog-fotos' and rol_actual() = 'admin');
end $$;

-- ===== 008_formato_backlog.sql =====
-- Formato "Mantenimiento correctivo programado": tipo de pedido, justificación,
-- componente y horómetro del backlog; marca del equipo; repuestos con ítem, número
-- de parte, stock, componente y observaciones; foto por línea de repuesto.

alter table equipos add column if not exists marca text;

alter table backlogs add column if not exists tipo_pedido text not null default 'Normal';
alter table backlogs drop constraint if exists backlogs_tipo_pedido_check;
alter table backlogs add constraint backlogs_tipo_pedido_check check (tipo_pedido in ('Normal', 'Urgente'));
alter table backlogs add column if not exists justificacion text;
alter table backlogs add column if not exists componente text;       -- ej. Block de implementos
alter table backlogs add column if not exists horometro numeric;     -- horómetro del equipo al detectar
alter table backlogs drop constraint if exists backlogs_horometro_check;
alter table backlogs add constraint backlogs_horometro_check check (horometro is null or horometro >= 0);

-- Repuestos: se identifican por número de parte, por código SAP o por los dos.
alter table backlog_repuestos add column if not exists item integer;
alter table backlog_repuestos add column if not exists numero_parte text;
alter table backlog_repuestos add column if not exists stock numeric;
alter table backlog_repuestos add column if not exists componente text;
alter table backlog_repuestos add column if not exists observaciones text;
alter table backlog_repuestos alter column cod_sap drop not null;
alter table backlog_repuestos drop constraint if exists backlog_repuestos_cod_sap_check;
alter table backlog_repuestos drop constraint if exists backlog_repuestos_identificacion;
alter table backlog_repuestos add constraint backlog_repuestos_identificacion
  check (coalesce(trim(numero_parte), '') <> '' or coalesce(trim(cod_sap), '') <> '');
alter table backlog_repuestos drop constraint if exists backlog_repuestos_stock_check;
alter table backlog_repuestos add constraint backlog_repuestos_stock_check check (stock is null or stock >= 0);

-- Repuestos cargados antes de esta migración: ítem según orden de carga.
update backlog_repuestos r set item = x.n
from (select id, row_number() over (partition by backlog_id order by creado_en, ctid) as n
      from backlog_repuestos) x
where x.id = r.id and r.item is null;

-- Ítem correlativo por backlog cuando la app no lo manda.
create or replace function tg_repuesto_item() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.item is null then
    select coalesce(max(item), 0) + 1 into new.item from backlog_repuestos where backlog_id = new.backlog_id;
  end if;
  return new;
end $$;

drop trigger if exists repuesto_item on backlog_repuestos;
create trigger repuesto_item before insert on backlog_repuestos
  for each row execute function tg_repuesto_item();

alter table backlog_fotos add column if not exists repuesto_id uuid references backlog_repuestos(id);

-- v_backlog con las columnas nuevas (b.* las incluye) y la marca del equipo.
drop view if exists v_backlog;
create view v_backlog as
with hh as (
  select backlog_id,
         sum(hh) filter (where tipo = 'estimada') as hh_estimadas,
         sum(hh) filter (where tipo = 'real')     as hh_reales
  from backlog_hh group by backlog_id
),
rep as (
  select backlog_id,
         count(*) as repuestos_total,
         count(*) filter (where estado <> 'Recibido') as repuestos_pendientes
  from backlog_repuestos group by backlog_id
)
select b.*,
       e.cod_interno, e.modelo, e.flota,
       s.nombre as sistema,
       case when b.estado in ('Ejecutado','Cerrado') then coalesce(b.fecha_ejecucion, hoy()) - b.fecha_deteccion
            else hoy() - b.fecha_deteccion end as antiguedad_dias,
       case when b.estado in ('Ejecutado','Cerrado','Rechazado','Anulado') then null
            else b.fecha_limite - hoy() end as dias_para_limite,
       (b.estado not in ('Ejecutado','Cerrado','Rechazado','Anulado') and b.fecha_limite < hoy()) as vencido,
       coalesce(hh.hh_estimadas, 0) as hh_estimadas,
       coalesce(hh.hh_reales, 0)    as hh_reales,
       coalesce(rep.repuestos_total, 0)      as repuestos_total,
       coalesce(rep.repuestos_pendientes, 0) as repuestos_pendientes,
       e.marca
from backlogs b
join equipos e  on e.id = b.equipo_id
join sistemas s on s.id = b.sistema_id
left join hh  on hh.backlog_id = b.id
left join rep on rep.backlog_id = b.id;

alter view v_backlog set (security_invoker = true);

-- ===== 009_reprogramar.sql =====
-- Reprogramación directa: cambiar_estado_backlog acepta Programado -> Programado
-- con otra fecha y motivo, en un solo llamado (antes había que pasar por Listo para
-- programar). Suma 1 a reprogramaciones, mantiene la OT y deja en la bitácora
-- "fecha anterior -> fecha nueva · motivo". Reemplaza la función de 004.
--
--   Programado -> Programado (admin: fecha_programada nueva, motivo)

create or replace function cambiar_estado_backlog(p_id uuid, p_estado text, p_datos jsonb default '{}'::jsonb)
returns backlogs
language plpgsql security definer set search_path = public as $$
declare
  b          backlogs;
  v_rol      text := rol_actual();
  v_motivo   text := nullif(trim(p_datos->>'motivo'), '');
  v_coment   text := nullif(trim(p_datos->>'comentario'), '');
  v_tipo_ev  text := 'estado';
  v_pend     integer;
  v_total    integer;
  v_fecha    date;
  v_semana   date;
  v_anterior text;
  v_detalle  text;
  v_fecha_ant date;
begin
  select * into b from backlogs where id = p_id for update;
  if not found then
    raise exception 'Backlog inexistente';
  end if;
  v_anterior := b.estado;
  if v_rol is null or v_rol = 'invitado' or not unidad_permitida(b.unidad_id) then
    raise exception 'Sin permiso para cambiar este backlog';
  end if;
  if p_estado = b.estado and p_estado <> 'Programado' then
    raise exception 'El backlog ya está %', b.estado;
  end if;

  select count(*), count(*) filter (where estado <> 'Recibido')
    into v_total, v_pend
  from backlog_repuestos where backlog_id = b.id;

  -- Transiciones permitidas y quién las hace
  if not (
       (b.estado = 'Identificado'         and p_estado in ('En planificación','Rechazado'))
    or (b.estado = 'En planificación'     and p_estado in ('Esperando repuestos','Listo para programar'))
    or (b.estado = 'Esperando repuestos'  and p_estado in ('Listo para programar','En planificación'))
    or (b.estado = 'Listo para programar' and p_estado in ('Programado','En planificación'))
    or (b.estado = 'Programado'           and p_estado in ('Ejecutado','Listo para programar','Programado'))
    or (b.estado = 'Ejecutado'            and p_estado = 'Cerrado')
    or (b.estado in ('Identificado','En planificación','Esperando repuestos','Listo para programar','Programado')
        and p_estado = 'Anulado')
  ) then
    raise exception 'No se puede pasar de % a %', b.estado, p_estado;
  end if;
  if v_rol <> 'admin' and not (b.estado = 'Programado' and p_estado = 'Ejecutado') then
    raise exception 'Solo el administrador puede pasar de % a %', b.estado, p_estado;
  end if;

  perform set_config('backlog.transicion', 'si', true);

  if p_datos ? 'prioridad' and b.estado in ('Identificado','En planificación') then
    b.prioridad := p_datos->>'prioridad';
  end if;

  case p_estado
    when 'En planificación' then
      if b.estado = 'Identificado'
         and not exists (select 1 from backlog_hh where backlog_id = b.id and tipo = 'estimada') then
        raise exception 'Cargue las HH estimadas por especialidad antes de planificar';
      end if;
    when 'Esperando repuestos' then
      if v_pend = 0 then
        raise exception 'No hay repuestos pendientes de recibir';
      end if;
    when 'Listo para programar' then
      if v_pend > 0 then
        raise exception 'Faltan % repuesto(s) por recibir', v_pend;
      end if;
      if b.estado = 'Programado' then
        if v_motivo is null then
          raise exception 'Indique el motivo de la reprogramación';
        end if;
        b.reprogramaciones := b.reprogramaciones + 1;
        b.semana_programada := null;
        b.fecha_programada := null;
        v_tipo_ev := 'reprogramación';
      end if;
    when 'Programado' then
      if b.estado = 'Programado' then
        -- Reprogramación directa: otra fecha, misma OT, con motivo.
        v_fecha_ant := b.fecha_programada;
        if v_motivo is null then
          raise exception 'Indique el motivo de la reprogramación';
        end if;
        if (p_datos->>'fecha_programada') is null or (p_datos->>'fecha_programada')::date = v_fecha_ant then
          raise exception 'Indique una fecha programada distinta a la actual';
        end if;
        b.reprogramaciones := b.reprogramaciones + 1;
        v_tipo_ev := 'reprogramación';
        v_detalle := format('%s → %s', to_char(v_fecha_ant, 'DD/MM/YYYY'),
                            to_char((p_datos->>'fecha_programada')::date, 'DD/MM/YYYY'));
      end if;
      v_fecha := coalesce((p_datos->>'fecha_programada')::date, b.fecha_programada);
      v_semana := coalesce((p_datos->>'semana_programada')::date, date_trunc('week', v_fecha)::date);
      b.ot_sap := coalesce(nullif(trim(p_datos->>'ot_sap'), ''), b.ot_sap);
      if v_fecha is null or b.ot_sap is null then
        raise exception 'Para programar indique fecha programada y OT SAP';
      end if;
      if v_fecha < hoy() then
        raise exception 'La fecha programada no puede ser pasada';
      end if;
      if date_trunc('week', v_fecha)::date <> v_semana then
        raise exception 'La fecha programada no cae en la semana indicada';
      end if;
      b.fecha_programada := v_fecha;
      b.semana_programada := v_semana;
      b.aprovechar_pm := coalesce((p_datos->>'aprovechar_pm')::boolean, b.aprovechar_pm);
    when 'Ejecutado' then
      v_fecha := (p_datos->>'fecha_ejecucion')::date;
      if v_fecha is null then
        raise exception 'Indique la fecha de ejecución';
      end if;
      if v_fecha > hoy() then
        raise exception 'La fecha de ejecución no puede ser futura';
      end if;
      if not exists (select 1 from backlog_hh where backlog_id = b.id and tipo = 'real') then
        raise exception 'Cargue las HH reales por especialidad antes de marcar ejecutado';
      end if;
      b.fecha_ejecucion := v_fecha;
    when 'Rechazado', 'Anulado' then
      if v_motivo is null then
        raise exception 'Indique el motivo';
      end if;
      b.motivo_anulacion := v_motivo;
    else
      null;
  end case;

  update backlogs set
    estado = p_estado,
    prioridad = b.prioridad,
    ot_sap = b.ot_sap,
    semana_programada = b.semana_programada,
    fecha_programada = b.fecha_programada,
    aprovechar_pm = b.aprovechar_pm,
    fecha_ejecucion = b.fecha_ejecucion,
    reprogramaciones = b.reprogramaciones,
    motivo_anulacion = b.motivo_anulacion
  where id = b.id
  returning * into b;

  insert into backlog_eventos (backlog_id, tipo, estado_anterior, estado_nuevo, texto)
  values (b.id, v_tipo_ev, v_anterior, p_estado, nullif(concat_ws(' · ', v_detalle, v_motivo, v_coment), ''));

  perform set_config('backlog.transicion', 'no', true);
  return b;
end $$;

-- ===== 010_validado.sql =====
-- El estado final "Cerrado" pasa a llamarse "Validado" (pedido del usuario: el
-- flujo visible es Identificado, Planeado, Programado, Ejecutado, Validado).
-- Se cambian los datos, la restricción de estados y cada función y vista que
-- nombra el estado, a partir de su definición actual en la base. Se puede repetir.

alter table backlogs drop constraint if exists backlogs_estado_check;

-- Los datos: el disparador de cambios exige pasar por cambiar_estado_backlog();
-- aquí se marca la transacción como transición autorizada.
do $$
begin
  perform set_config('backlog.transicion', 'si', true);
  update backlogs set estado = 'Validado' where estado = 'Cerrado';
  perform set_config('backlog.transicion', 'no', true);
end $$;
update backlog_eventos set estado_nuevo = 'Validado' where estado_nuevo = 'Cerrado';
update backlog_eventos set estado_anterior = 'Validado' where estado_anterior = 'Cerrado';

alter table backlogs add constraint backlogs_estado_check check (estado in
  ('Identificado','En planificación','Esperando repuestos','Listo para programar',
   'Programado','Ejecutado','Validado','Rechazado','Anulado'));

-- Funciones: cambiar_estado_backlog (de 009), tg_backlog_cambio y tg_detalle_editable (de 003).
do $$
declare
  f text;
begin
  for f in
    select pg_get_functiondef(p.oid)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('cambiar_estado_backlog', 'tg_backlog_cambio', 'tg_detalle_editable')
  loop
    execute replace(f, '''Cerrado''', '''Validado''');
  end loop;
end $$;

-- Vistas: mismas columnas, solo cambia el literal.
do $$
declare
  v text;
begin
  foreach v in array array['v_backlog', 'v_backlog_semanal'] loop
    execute format('create or replace view %I as %s', v,
                   replace(pg_get_viewdef(v::regclass), '''Cerrado''', '''Validado'''));
    execute format('alter view %I set (security_invoker = true)', v);
  end loop;
end $$;
