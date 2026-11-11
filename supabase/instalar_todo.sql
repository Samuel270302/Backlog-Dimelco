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

-- ===== 011_fotos.sql =====
-- Fotos: suben admin y capturador de la unidad; borra solo el admin, igual que el
-- archivo en Storage (007). Antes la política "for all" de 006 dejaba al capturador
-- borrar la fila aunque no pudiera borrar el archivo.

drop policy if exists editar_backlog_fotos on backlog_fotos;

drop policy if exists subir_backlog_fotos on backlog_fotos;
create policy subir_backlog_fotos on backlog_fotos for insert to authenticated
  with check (rol_actual() in ('admin','capturador') and unidad_permitida(unidad_de_backlog(backlog_id))
              and creado_por = usuario_sesion());

drop policy if exists cambiar_backlog_fotos on backlog_fotos;
create policy cambiar_backlog_fotos on backlog_fotos for update to authenticated
  using (rol_actual() in ('admin','capturador') and unidad_permitida(unidad_de_backlog(backlog_id)))
  with check (rol_actual() in ('admin','capturador') and unidad_permitida(unidad_de_backlog(backlog_id)));

drop policy if exists borrar_backlog_fotos on backlog_fotos;
create policy borrar_backlog_fotos on backlog_fotos for delete to authenticated
  using (rol_actual() = 'admin' and unidad_permitida(unidad_de_backlog(backlog_id)));

-- ===== 012_recalcular_limites.sql =====
-- Recalcula la fecha límite de los backlogs abiertos con los plazos vigentes por
-- prioridad (parametros plazo_pN_dias). Solo el admin. Devuelve cuántos cambiaron.
-- Sin esto, un plazo nuevo solo rige para backlogs nuevos o que cambian de prioridad.

create or replace function recalcular_fechas_limite() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_n integer;
begin
  if coalesce(rol_actual(), '') <> 'admin' then
    raise exception 'Solo el administrador puede recalcular las fechas límite';
  end if;
  update backlogs
     set fecha_limite = fecha_deteccion + plazo_prioridad(prioridad)
   where estado in ('Identificado','En planificación','Esperando repuestos','Listo para programar','Programado')
     and fecha_limite is distinct from fecha_deteccion + plazo_prioridad(prioridad);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke execute on function recalcular_fechas_limite() from public;
grant execute on function recalcular_fechas_limite() to authenticated;

-- ===== 013_numero_formato.sql =====
-- N° del formato en papel (ej. 105) como referencia de los backlogs importados desde
-- Excel. Único por unidad: el mismo formato no se importa dos veces.

alter table backlogs add column if not exists numero_formato text;
drop index if exists backlogs_numero_formato;
create unique index backlogs_numero_formato on backlogs (unidad_id, numero_formato) where numero_formato is not null;

-- v_backlog usa b.*: se recrea para que incluya la columna nueva (estado final Validado, de 010).
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
       case when b.estado in ('Ejecutado','Validado') then coalesce(b.fecha_ejecucion, hoy()) - b.fecha_deteccion
            else hoy() - b.fecha_deteccion end as antiguedad_dias,
       case when b.estado in ('Ejecutado','Validado','Rechazado','Anulado') then null
            else b.fecha_limite - hoy() end as dias_para_limite,
       (b.estado not in ('Ejecutado','Validado','Rechazado','Anulado') and b.fecha_limite < hoy()) as vencido,
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

-- ===== 014_mejoras.sql =====
-- Mejoras del 06/11/2026: familias de equipo con sus sistemas, "Otro" con texto,
-- reportado y aprobado por, capacidad editable por el capturador de su unidad,
-- SAP solo en HEMCO, especialidad Electromecánico y prioridades de la OT de Dimelco.
-- Se puede repetir.

-- Familias de equipo (Scooptram ST1030, PowerROC T35...) y los sistemas de cada una.
create table if not exists familias (
  id      uuid primary key default gen_random_uuid(),
  nombre  text not null unique,
  activo  boolean not null default true,
  orden   integer not null default 0
);
create table if not exists familia_sistemas (
  familia_id  uuid not null references familias(id) on delete cascade,
  sistema_id  uuid not null references sistemas(id) on delete cascade,
  primary key (familia_id, sistema_id)
);
alter table equipos add column if not exists familia_id uuid references familias(id);

-- Las flotas escritas a mano pasan a ser familias; cada equipo queda en la suya.
insert into familias (nombre)
select distinct trim(flota) from equipos where familia_id is null and coalesce(trim(flota), '') <> ''
on conflict (nombre) do nothing;
update equipos e set familia_id = f.id
from familias f
where e.familia_id is null and f.nombre = trim(e.flota);

alter table familias enable row level security;
alter table familia_sistemas enable row level security;
do $$
declare t text;
begin
  foreach t in array array['familias','familia_sistemas'] loop
    execute format('drop policy if exists leer_%I on %I', t, t);
    execute format('create policy leer_%I on %I for select to authenticated
                    using (rol_actual() is not null)', t, t);
    execute format('drop policy if exists administrar_%I on %I', t, t);
    execute format('create policy administrar_%I on %I for all to authenticated
                    using (rol_actual() = ''admin'') with check (rol_actual() = ''admin'')', t, t);
  end loop;
end $$;
grant select, insert, update, delete on familias, familia_sistemas to authenticated;

-- Backlog: texto del sistema cuando es "Otro" y quién aprueba la necesidad.
alter table backlogs add column if not exists sistema_otro text;
alter table backlogs add column if not exists aprobado_por text;

-- Validaciones al registrar y al editar. Reportado y aprobado se exigen solo a los
-- backlogs nuevos, y el texto de "Otro" solo cuando se cambia el sistema: los backlogs
-- anteriores a este cambio no los tienen.
create or replace function tg_backlog_validar() returns trigger
language plpgsql as $$
begin
  if (select nombre from sistemas where id = new.sistema_id) = 'Otro'
     and coalesce(trim(new.sistema_otro), '') = ''
     and (tg_op = 'INSERT' or new.sistema_id is distinct from old.sistema_id or new.sistema_otro is distinct from old.sistema_otro) then
    raise exception 'Con sistema "Otro" indique cuál es el sistema';
  end if;
  if (select nombre from sistemas where id = new.sistema_id) <> 'Otro' then
    new.sistema_otro := null;
  end if;
  if tg_op = 'INSERT' and (coalesce(trim(new.reportado_por), '') = '' or coalesce(trim(new.aprobado_por), '') = '') then
    raise exception 'Indique quién reporta la necesidad y quién la aprueba';
  end if;
  return new;
end $$;
drop trigger if exists backlog_validar on backlogs;
create trigger backlog_validar before insert or update on backlogs
  for each row execute function tg_backlog_validar();

-- Capacidad del taller: el capturador también la edita, solo en su unidad.
drop policy if exists administrar_capacidad_taller on capacidad_taller;
create policy administrar_capacidad_taller on capacidad_taller for all to authenticated
  using (rol_actual() in ('admin','capturador') and unidad_permitida(unidad_id))
  with check (rol_actual() in ('admin','capturador') and unidad_permitida(unidad_id));

-- SAP: solo HEMCO lo usa. Las demás unidades ven "N° OT" y nada más de SAP.
alter table unidades add column if not exists usa_sap boolean not null default false;
update unidades set usa_sap = (sigla = 'HEM');

do $$
declare
  f text;
begin
  select pg_get_functiondef(p.oid) into f
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'cambiar_estado_backlog';
  execute replace(f, 'Para programar indique fecha programada y OT SAP', 'Para programar indique fecha programada y N° de OT');
end $$;

-- Especialidad nueva.
insert into especialidades (nombre, orden) values ('Electromecánico', 6)
on conflict (nombre) do nothing;

-- Prioridades según los niveles de criticidad de la OT de Dimelco:
-- 1 Urgente (24 horas), 2 Alto (3 días), 3 Medio (14 días), 4 Bajo (40 días).
update parametros set valor = v.dias, descripcion = v.texto
from (values
  ('plazo_p1_dias',  1, 'Días para atender un backlog 1 Urgente (máximo 24 horas)'),
  ('plazo_p2_dias',  3, 'Días para atender un backlog 2 Alto (hasta 3 días)'),
  ('plazo_p3_dias', 14, 'Días para atender un backlog 3 Medio (hasta 14 días)'),
  ('plazo_p4_dias', 40, 'Días para atender un backlog 4 Bajo (hasta 40 días)')
) as v(clave, dias, texto)
where parametros.clave = v.clave and not exists (select 1 from parametros where clave = 'prioridades_dimelco');
insert into parametros (clave, valor, descripcion)
values ('prioridades_dimelco', 1, 'Marca: plazos de la OT de Dimelco ya cargados (014). No borrar')
on conflict (clave) do nothing;
update backlogs
   set fecha_limite = fecha_deteccion + plazo_prioridad(prioridad)
 where estado in ('Identificado','En planificación','Esperando repuestos','Listo para programar','Programado')
   and fecha_limite is distinct from fecha_deteccion + plazo_prioridad(prioridad);

-- v_backlog usa b.*: se recrea con las columnas nuevas. La flota mostrada es la familia.
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
       e.cod_interno, e.modelo, coalesce(f.nombre, e.flota) as flota,
       case when s.nombre = 'Otro' and b.sistema_otro is not null then 'Otro: ' || b.sistema_otro else s.nombre end as sistema,
       case when b.estado in ('Ejecutado','Validado') then coalesce(b.fecha_ejecucion, hoy()) - b.fecha_deteccion
            else hoy() - b.fecha_deteccion end as antiguedad_dias,
       case when b.estado in ('Ejecutado','Validado','Rechazado','Anulado') then null
            else b.fecha_limite - hoy() end as dias_para_limite,
       (b.estado not in ('Ejecutado','Validado','Rechazado','Anulado') and b.fecha_limite < hoy()) as vencido,
       coalesce(hh.hh_estimadas, 0) as hh_estimadas,
       coalesce(hh.hh_reales, 0)    as hh_reales,
       coalesce(rep.repuestos_total, 0)      as repuestos_total,
       coalesce(rep.repuestos_pendientes, 0) as repuestos_pendientes,
       e.marca,
       e.familia_id,
       u.usa_sap
from backlogs b
join equipos e  on e.id = b.equipo_id
join unidades u on u.id = b.unidad_id
join sistemas s on s.id = b.sistema_id
left join familias f on f.id = e.familia_id
left join hh  on hh.backlog_id = b.id
left join rep on rep.backlog_id = b.id;

alter view v_backlog set (security_invoker = true);

-- ===== 015_borrar.sql =====
-- Borrar backlogs: admin o capturador de la unidad, en cualquier estado y con motivo.
-- El backlog no se elimina: se oculta de todas las vistas y el admin lo puede
-- restaurar. El folio no se reutiliza. Se puede repetir.

alter table backlogs add column if not exists borrado_en timestamptz;
alter table backlogs add column if not exists borrado_por uuid;
alter table backlogs add column if not exists motivo_borrado text;

alter table backlog_eventos drop constraint if exists backlog_eventos_tipo_check;
alter table backlog_eventos add constraint backlog_eventos_tipo_check
  check (tipo in ('estado','comentario','repuesto','reprogramación','borrado','restaurado'));

-- Un backlog borrado no se edita ni se le cambia el detalle; solo lo tocan
-- borrar_backlog() y restaurar_backlog(). Los triggers corren por nombre: backlog_cambio
-- (que fija actualizado_en) va antes que backlog_no_borrado.
create or replace function tg_backlog_no_borrado() returns trigger
language plpgsql as $$
begin
  -- Recalcular la fecha límite (al cambiar plazos) sí se permite.
  if old.borrado_en is not null and coalesce(current_setting('backlog.borrado', true), '') <> 'si'
     and to_jsonb(new) - 'fecha_limite' - 'actualizado_en' <> to_jsonb(old) - 'fecha_limite' - 'actualizado_en' then
    raise exception 'El backlog % está borrado: no se edita', old.folio;
  end if;
  if coalesce(current_setting('backlog.borrado', true), '') <> 'si'
     and (new.borrado_en is distinct from old.borrado_en or new.borrado_por is distinct from old.borrado_por
          or new.motivo_borrado is distinct from old.motivo_borrado) then
    raise exception 'Para borrar un backlog use borrar_backlog()';
  end if;
  return new;
end $$;
drop trigger if exists backlog_no_borrado on backlogs;
create trigger backlog_no_borrado before update on backlogs
  for each row execute function tg_backlog_no_borrado();

create or replace function tg_detalle_no_borrado() returns trigger
language plpgsql as $$
declare
  v_id uuid;
begin
  if tg_op = 'DELETE' then v_id := old.backlog_id; else v_id := new.backlog_id; end if;
  if exists (select 1 from backlogs where id = v_id and borrado_en is not null) then
    raise exception 'El backlog está borrado: su detalle no se edita';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
do $$
declare t text;
begin
  foreach t in array array['backlog_hh','backlog_repuestos','backlog_fotos'] loop
    execute format('drop trigger if exists detalle_no_borrado on %I', t);
    execute format('create trigger detalle_no_borrado before insert or update or delete on %I
                    for each row execute function tg_detalle_no_borrado()', t);
  end loop;
end $$;

create or replace function borrar_backlog(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_rol  text := rol_actual();
  b      backlogs;
begin
  select * into b from backlogs where id = p_id for update;
  if not found then
    raise exception 'Backlog inexistente';
  end if;
  if v_rol is null or v_rol not in ('admin', 'capturador') or not unidad_permitida(b.unidad_id) then
    raise exception 'Solo el administrador o un capturador de la unidad pueden borrar el backlog %', b.folio;
  end if;
  if b.borrado_en is not null then
    raise exception 'El backlog % ya está borrado', b.folio;
  end if;
  if length(coalesce(trim(p_motivo), '')) < 5 then
    raise exception 'Indique el motivo del borrado (mínimo 5 letras)';
  end if;
  perform set_config('backlog.borrado', 'si', true);
  perform set_config('backlog.transicion', 'si', true);
  update backlogs
     set borrado_en = now(), borrado_por = usuario_sesion(), motivo_borrado = trim(p_motivo)
   where id = p_id;
  perform set_config('backlog.transicion', 'no', true);
  perform set_config('backlog.borrado', 'no', true);
  insert into backlog_eventos (backlog_id, tipo, estado_anterior, texto, usuario)
  values (p_id, 'borrado', b.estado, 'Borrado: ' || trim(p_motivo), usuario_sesion());
end $$;

create or replace function restaurar_backlog(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  b backlogs;
begin
  if coalesce(rol_actual(), '') <> 'admin' then
    raise exception 'Solo el administrador puede restaurar un backlog borrado';
  end if;
  select * into b from backlogs where id = p_id for update;
  if not found or b.borrado_en is null then
    raise exception 'El backlog no está borrado';
  end if;
  perform set_config('backlog.borrado', 'si', true);
  perform set_config('backlog.transicion', 'si', true);
  update backlogs set borrado_en = null, borrado_por = null, motivo_borrado = null where id = p_id;
  perform set_config('backlog.transicion', 'no', true);
  perform set_config('backlog.borrado', 'no', true);
  insert into backlog_eventos (backlog_id, tipo, estado_nuevo, texto, usuario)
  values (p_id, 'restaurado', b.estado, 'Restaurado (había sido borrado por: ' || b.motivo_borrado || ')', usuario_sesion());
end $$;

revoke execute on function borrar_backlog(uuid, text), restaurar_backlog(uuid) from public;
grant execute on function borrar_backlog(uuid, text), restaurar_backlog(uuid) to authenticated;

-- Vistas: los borrados no cuentan en ninguna pantalla, reporte ni indicador.
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
       e.cod_interno, e.modelo, coalesce(f.nombre, e.flota) as flota,
       case when s.nombre = 'Otro' and b.sistema_otro is not null then 'Otro: ' || b.sistema_otro else s.nombre end as sistema,
       case when b.estado in ('Ejecutado','Validado') then coalesce(b.fecha_ejecucion, hoy()) - b.fecha_deteccion
            else hoy() - b.fecha_deteccion end as antiguedad_dias,
       case when b.estado in ('Ejecutado','Validado','Rechazado','Anulado') then null
            else b.fecha_limite - hoy() end as dias_para_limite,
       (b.estado not in ('Ejecutado','Validado','Rechazado','Anulado') and b.fecha_limite < hoy()) as vencido,
       coalesce(hh.hh_estimadas, 0) as hh_estimadas,
       coalesce(hh.hh_reales, 0)    as hh_reales,
       coalesce(rep.repuestos_total, 0)      as repuestos_total,
       coalesce(rep.repuestos_pendientes, 0) as repuestos_pendientes,
       e.marca,
       e.familia_id,
       u.usa_sap
from backlogs b
join equipos e  on e.id = b.equipo_id
join unidades u on u.id = b.unidad_id
join sistemas s on s.id = b.sistema_id
left join familias f on f.id = e.familia_id
left join hh  on hh.backlog_id = b.id
left join rep on rep.backlog_id = b.id
where b.borrado_en is null;

create or replace view v_hh_pendiente as
select b.unidad_id, h.especialidad_id, b.estado, sum(h.hh) as hh
from backlogs b
join backlog_hh h on h.backlog_id = b.id and h.tipo = 'estimada'
where b.estado in ('Identificado','En planificación','Esperando repuestos','Listo para programar','Programado')
  and b.borrado_en is null
group by b.unidad_id, h.especialidad_id, b.estado;

create or replace view v_carga_semanal as
select b.unidad_id, b.semana_programada as semana, h.especialidad_id, sum(h.hh) as hh_programadas,
       count(distinct b.id) as backlogs
from backlogs b
join backlog_hh h on h.backlog_id = b.id and h.tipo = 'estimada'
where b.estado = 'Programado' and b.borrado_en is null
group by b.unidad_id, b.semana_programada, h.especialidad_id;

create or replace view v_backlog_semanal as
with ing as (
  select unidad_id, date_trunc('week', fecha_deteccion)::date as semana,
         count(*) as ingresos,
         count(*) filter (where estado not in ('Rechazado','Anulado')) as ingresos_validos
  from backlogs where borrado_en is null group by 1, 2
),
cie as (
  select unidad_id, date_trunc('week', fecha_ejecucion)::date as semana,
         count(*) as cierres,
         count(*) filter (where fecha_ejecucion <= fecha_limite) as cierres_en_plazo
  from backlogs
  where estado in ('Ejecutado','Validado') and fecha_ejecucion is not null and borrado_en is null
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

-- Lista de borrados para el administrador (cada uno ve solo lo de sus unidades).
create or replace view v_backlog_borrados as
select b.id, b.folio, b.unidad_id, un.nombre as unidad, e.cod_interno, e.modelo, b.descripcion, b.estado,
       b.prioridad, b.fecha_deteccion, b.borrado_en, b.borrado_por, p.nombre as borrado_por_nombre, b.motivo_borrado
from backlogs b
join equipos e   on e.id = b.equipo_id
join unidades un on un.id = b.unidad_id
left join perfiles p on p.user_id = b.borrado_por
where b.borrado_en is not null;

do $$
declare v text;
begin
  foreach v in array array['v_backlog','v_hh_pendiente','v_carga_semanal','v_backlog_semanal','v_backlog_borrados'] loop
    execute format('alter view %I set (security_invoker = true)', v);
  end loop;
end $$;
grant select on v_backlog_borrados to authenticated;

-- ===== 016_sistemas_por_familia.sql =====
-- Sistemas por familia de equipo, tomados de los listados de sistemas de la biblioteca
-- (BIblioteca > Equipos de perforacion > Listados de sistemas, 06/11/2026): capítulos de
-- los manuales de mantenimiento cruzados con los grupos de los catálogos de partes.
-- Un solo catálogo de sistemas con el mismo nombre en todas las familias, para que los
-- indicadores se puedan comparar entre equipos. Se puede repetir; no borra lo que el
-- administrador agregue después en Familias y sistemas.

-- 1. Nombres: los sistemas iniciales toman el nombre del catálogo nuevo (mismo id, así
--    los backlogs que ya los usan no cambian).
do $$
declare
  r record;
begin
  for r in select * from (values
    ('Motor', 'Motor diésel'),
    ('Transmisión', 'Tren de potencia'),
    ('Estructura y chasis', 'Bastidor y chasis'),
    ('Neumáticos', 'Ruedas y neumáticos'),
    ('Empernadora', 'Unidad de empernado'),
    ('Cabina y seguridad', 'Cabina y entorno del operador')
  ) v(antes, despues) loop
    update sistemas set nombre = r.despues
     where nombre = r.antes and not exists (select 1 from sistemas where nombre = r.despues);
    -- Al repetir la instalación, 002 vuelve a crear el nombre viejo: si nadie lo usa se
    -- borra; si algún backlog lo usa, se desactiva.
    delete from sistemas s
     where s.nombre = r.antes
       and not exists (select 1 from backlogs b where b.sistema_id = s.id)
       and not exists (select 1 from familia_sistemas fs where fs.sistema_id = s.id);
    update sistemas set activo = false where nombre = r.antes;
  end loop;
end $$;

insert into sistemas (nombre, orden) values
  ('Motor diésel', 1),
  ('Sistema de enfriamiento', 2),
  ('Admisión y escape', 3),
  ('Tren de potencia', 4),
  ('Frenos', 5),
  ('Dirección', 6),
  ('Sistema hidráulico', 7),
  ('Sistema eléctrico', 8),
  ('Control y electrónica', 9),
  ('Neumático y agua', 10),
  ('Compresor', 11),
  ('Neblina de agua', 12),
  ('Lubricación', 13),
  ('Extinción de incendios', 14),
  ('Cabina y entorno del operador', 15),
  ('Bastidor y chasis', 16),
  ('Ruedas y neumáticos', 17),
  ('Tren de rodaje (orugas)', 18),
  ('Brazo (boom)', 19),
  ('Cuchara', 20),
  ('Caja de carga', 21),
  ('Unidad de avance', 22),
  ('Perforadora', 23),
  ('Unidad de rotación', 24),
  ('Manejo de barras', 25),
  ('Colector de polvo', 26),
  ('Tambor de cable y manguera', 27),
  ('Unidad de empernado', 28),
  ('Manejo de malla', 29),
  ('Sistema de resina', 30),
  ('Bomba Swellex', 31),
  ('Cabrestante', 32),
  ('Cuba mezcladora', 33),
  ('Bomba de concreto', 34),
  ('Bomba dosificadora de aditivo', 35),
  ('Martillo de desatado', 36),
  ('Otro', 99)
on conflict (nombre) do update set orden = excluded.orden, activo = true;

-- 2. Familias, el patrón del modelo de sus equipos y sus sistemas.
drop table if exists pg_temp._familias;
create temporary table _familias (
  nombre   text primary key,
  orden    integer,
  patron   text,      -- expresión regular sobre equipos.modelo (sin distinguir mayúsculas)
  sistemas text[]
);

insert into _familias values
  ('Scooptram ST1030', 1, 'ST\s*1030',
   array['Motor diésel','Sistema de enfriamiento','Admisión y escape','Tren de potencia','Frenos','Dirección','Sistema hidráulico','Sistema eléctrico','Control y electrónica','Lubricación','Extinción de incendios','Cabina y entorno del operador','Bastidor y chasis','Ruedas y neumáticos','Brazo (boom)','Cuchara']),
  ('Scooptram ST3.5', 2, 'ST\s*3[.,]5',
   array['Motor diésel','Sistema de enfriamiento','Admisión y escape','Tren de potencia','Frenos','Dirección','Sistema hidráulico','Sistema eléctrico','Lubricación','Extinción de incendios','Cabina y entorno del operador','Bastidor y chasis','Ruedas y neumáticos','Brazo (boom)','Cuchara']),
  ('Caterpillar R1600H', 3, 'R\s*1600',
   array['Motor diésel','Sistema de enfriamiento','Admisión y escape','Tren de potencia','Frenos','Dirección','Sistema hidráulico','Sistema eléctrico','Control y electrónica','Cabina y entorno del operador','Bastidor y chasis','Cuchara']),
  ('Ground Force AT18E', 4, 'AT\s*18|UG\s*18',
   array['Motor diésel','Sistema de enfriamiento','Tren de potencia','Frenos','Dirección','Sistema hidráulico','Sistema eléctrico','Cabina y entorno del operador','Bastidor y chasis','Caja de carga']),
  ('Boomer S1D', 5, 'S1\s*D',
   array['Motor diésel','Sistema de enfriamiento','Admisión y escape','Tren de potencia','Frenos','Dirección','Sistema hidráulico','Sistema eléctrico','Control y electrónica','Neumático y agua','Compresor','Neblina de agua','Lubricación','Extinción de incendios','Cabina y entorno del operador','Bastidor y chasis','Ruedas y neumáticos','Brazo (boom)','Unidad de avance','Perforadora','Manejo de barras','Tambor de cable y manguera']),
  ('Boomer 282', 6, 'Boomer\s*282|^\s*282\s*$',
   array['Motor diésel','Admisión y escape','Tren de potencia','Frenos','Dirección','Sistema hidráulico','Sistema eléctrico','Control y electrónica','Neumático y agua','Compresor','Neblina de agua','Lubricación','Extinción de incendios','Cabina y entorno del operador','Bastidor y chasis','Ruedas y neumáticos','Brazo (boom)','Unidad de avance','Perforadora','Unidad de rotación','Tambor de cable y manguera']),
  ('Simba S7D', 7, 'S7\s*D|Simba',
   array['Motor diésel','Sistema de enfriamiento','Admisión y escape','Tren de potencia','Frenos','Dirección','Sistema hidráulico','Sistema eléctrico','Control y electrónica','Neumático y agua','Compresor','Neblina de agua','Lubricación','Extinción de incendios','Cabina y entorno del operador','Bastidor y chasis','Ruedas y neumáticos','Brazo (boom)','Unidad de avance','Perforadora','Manejo de barras','Tambor de cable y manguera']),
  ('Boltec S', 8, 'Boltec',
   array['Motor diésel','Sistema de enfriamiento','Admisión y escape','Tren de potencia','Frenos','Dirección','Sistema hidráulico','Sistema eléctrico','Control y electrónica','Neumático y agua','Compresor','Neblina de agua','Lubricación','Extinción de incendios','Cabina y entorno del operador','Bastidor y chasis','Ruedas y neumáticos','Brazo (boom)','Perforadora','Unidad de empernado','Manejo de malla','Sistema de resina','Bomba Swellex','Tambor de cable y manguera']),
  ('Resemin Bolter', 9, 'Bolter|77\s*D',
   array['Motor diésel','Tren de potencia','Frenos','Dirección','Sistema hidráulico','Sistema eléctrico','Control y electrónica','Neumático y agua','Compresor','Lubricación','Extinción de incendios','Bastidor y chasis','Ruedas y neumáticos','Brazo (boom)','Unidad de avance','Perforadora','Unidad de rotación','Unidad de empernado','Manejo de malla','Tambor de cable y manguera']),
  ('Resemin Raptor 44XP', 10, 'Raptor|44\s*XP',
   array['Motor diésel','Tren de potencia','Sistema hidráulico','Sistema eléctrico','Neumático y agua','Compresor','Lubricación','Bastidor y chasis','Brazo (boom)','Unidad de avance','Perforadora','Unidad de rotación']),
  ('Resemin Troidon 55XP', 11, 'Troidon|55\s*XP',
   array['Motor diésel','Tren de potencia','Dirección','Sistema hidráulico','Sistema eléctrico','Neumático y agua','Compresor','Lubricación','Extinción de incendios','Bastidor y chasis','Brazo (boom)','Unidad de avance','Perforadora']),
  ('Resemin Scalemin HT', 12, 'Scalemin',
   array['Motor diésel','Tren de potencia','Sistema hidráulico','Sistema eléctrico','Neumático y agua','Lubricación','Cabina y entorno del operador','Bastidor y chasis','Brazo (boom)','Tambor de cable y manguera','Martillo de desatado']),
  ('SmartROC T40', 13, 'SmartROC|T\s*40',
   array['Motor diésel','Sistema de enfriamiento','Sistema hidráulico','Sistema eléctrico','Control y electrónica','Compresor','Neblina de agua','Lubricación','Cabina y entorno del operador','Bastidor y chasis','Tren de rodaje (orugas)','Brazo (boom)','Unidad de avance','Perforadora','Manejo de barras','Colector de polvo','Cabrestante']),
  ('PowerROC T50', 14, 'T\s*50',
   array['Motor diésel','Sistema de enfriamiento','Sistema hidráulico','Sistema eléctrico','Compresor','Neblina de agua','Lubricación','Extinción de incendios','Cabina y entorno del operador','Bastidor y chasis','Tren de rodaje (orugas)','Brazo (boom)','Unidad de avance','Perforadora','Manejo de barras','Colector de polvo']),
  ('PowerROC T25 / T30 / T35', 15, 'T\s*(25|30|35)',
   array['Motor diésel','Sistema de enfriamiento','Admisión y escape','Sistema hidráulico','Sistema eléctrico','Compresor','Neblina de agua','Lubricación','Extinción de incendios','Cabina y entorno del operador','Bastidor y chasis','Tren de rodaje (orugas)','Brazo (boom)','Unidad de avance','Perforadora','Manejo de barras','Colector de polvo']),
  ('PowerROC D55', 16, 'D\s*55',
   array['Motor diésel','Sistema de enfriamiento','Sistema hidráulico','Sistema eléctrico','Compresor','Neblina de agua','Lubricación','Extinción de incendios','Cabina y entorno del operador','Bastidor y chasis','Tren de rodaje (orugas)','Brazo (boom)','Unidad de avance','Perforadora','Unidad de rotación','Manejo de barras','Colector de polvo','Cabrestante']),
  ('Furukawa HCR', 17, 'HCR|L\s*(90|100|110)|1[12]00\s*-?\s*ED',
   array['Motor diésel','Sistema hidráulico','Sistema eléctrico','Control y electrónica','Neumático y agua','Compresor','Cabina y entorno del operador','Bastidor y chasis','Tren de rodaje (orugas)','Brazo (boom)','Unidad de avance','Perforadora','Manejo de barras','Colector de polvo']),
  ('Furukawa DCR', 18, 'DCR|L\s*130',
   array['Motor diésel','Sistema hidráulico','Sistema eléctrico','Control y electrónica','Neumático y agua','Compresor','Cabina y entorno del operador','Bastidor y chasis','Tren de rodaje (orugas)','Brazo (boom)','Unidad de avance','Perforadora','Unidad de rotación','Manejo de barras','Colector de polvo']),
  ('XCMG XCZ115', 19, 'XCZ\s*115',
   array['Motor diésel','Sistema hidráulico','Sistema eléctrico','Compresor','Lubricación','Extinción de incendios','Cabina y entorno del operador','Bastidor y chasis','Tren de rodaje (orugas)','Brazo (boom)','Unidad de avance','Perforadora','Manejo de barras','Colector de polvo']),
  ('XCMG XQZ152', 20, 'XQZ\s*152',
   array['Motor diésel','Sistema hidráulico','Sistema eléctrico','Neumático y agua','Compresor','Lubricación','Cabina y entorno del operador','Bastidor y chasis','Tren de rodaje (orugas)','Brazo (boom)','Unidad de avance','Perforadora','Unidad de rotación','Manejo de barras','Colector de polvo']),
  ('Putzmeister Mixkret 4', 21, 'Mixkret',
   array['Motor diésel','Tren de potencia','Frenos','Dirección','Sistema hidráulico','Sistema eléctrico','Neumático y agua','Extinción de incendios','Cabina y entorno del operador','Bastidor y chasis','Ruedas y neumáticos','Cuba mezcladora']),
  ('Putzmeister SPM 4210', 22, 'SPM|4210',
   array['Motor diésel','Tren de potencia','Sistema hidráulico','Sistema eléctrico','Control y electrónica','Compresor','Lubricación','Bastidor y chasis','Brazo (boom)','Tambor de cable y manguera','Bomba de concreto','Bomba dosificadora de aditivo']);

-- Un sistema mal escrito en la lista de arriba detiene la migración.
do $$
declare
  v_falta text;
begin
  select string_agg(distinct s, ', ') into v_falta
  from _familias, unnest(sistemas) s
  where not exists (select 1 from sistemas where nombre = s);
  if v_falta is not null then
    raise exception 'Sistemas que no están en el catálogo: %', v_falta;
  end if;
end $$;

insert into familias (nombre, orden)
select nombre, orden from _familias
on conflict (nombre) do update set orden = excluded.orden, activo = true;

-- Relaciones: se agregan las de la lista; las que el admin marcó a mano se conservan.
insert into familia_sistemas (familia_id, sistema_id)
select f.id, s.id
from _familias t
join familias f on f.nombre = t.nombre
cross join lateral unnest(t.sistemas) n
join sistemas s on s.nombre = n
on conflict do nothing;

-- 3. Equipos: los que no tienen familia, o están en una familia creada desde la flota
--    escrita (sin sistemas marcados), pasan a la familia que corresponde a su modelo.
--    Si el modelo calza con más de una familia, no se cambia.
with candidatos as (
  select e.id as equipo_id, min(f.id::text)::uuid as familia_id, count(*) as n
  from equipos e
  join _familias t on e.modelo ~* t.patron
  join familias f on f.nombre = t.nombre
  where e.familia_id is null
     or not exists (select 1 from familia_sistemas r where r.familia_id = e.familia_id)
  group by e.id
)
update equipos e
   set familia_id = c.familia_id,
       flota = (select nombre from familias where id = c.familia_id)
  from candidatos c
 where c.equipo_id = e.id and c.n = 1;

-- Las familias que quedaron sin equipos y sin sistemas (creadas desde la flota) se
-- desactivan; no se borran.
update familias f set activo = false
 where f.activo
   and not exists (select 1 from equipos e where e.familia_id = f.id)
   and not exists (select 1 from familia_sistemas r where r.familia_id = f.id)
   and f.nombre not in (select nombre from _familias);

drop table _familias;

-- ===== 017_varias_unidades.sql =====
-- Varias unidades por capturador o invitado. perfiles.unidades guarda todas las que
-- puede ver; unidad_id queda como la primera, para la restricción
-- perfiles_unidad_requerida y para la Edge Function admin-usuarios, que solo fija
-- unidad_id al crear (el disparador la pasa a unidades). El admin sigue viendo todas.
-- Se puede repetir.

alter table perfiles add column if not exists unidades uuid[] not null default '{}';
update perfiles set unidades = array[unidad_id] where cardinality(unidades) = 0 and unidad_id is not null;

create or replace function tg_perfil_unidades() returns trigger
language plpgsql as $$
begin
  new.unidades := coalesce(new.unidades, '{}');
  if tg_op = 'UPDATE' then
    -- Se quitaron todas las unidades: queda sin unidad (si está activo y no es admin,
    -- perfiles_unidad_requerida lo rechaza).
    if new.unidades is distinct from old.unidades and cardinality(new.unidades) = 0 then
      new.unidad_id := null;
      return new;
    end if;
    -- Cambio de unidad_id a la antigua (una sola unidad): reemplaza la lista.
    if new.unidad_id is distinct from old.unidad_id and new.unidades is not distinct from old.unidades
       and new.unidad_id is not null and not (new.unidad_id = any(new.unidades)) then
      new.unidades := array[new.unidad_id];
    end if;
  end if;
  if cardinality(new.unidades) = 0 and new.unidad_id is not null then
    new.unidades := array[new.unidad_id];
  elsif cardinality(new.unidades) > 0 and (new.unidad_id is null or not (new.unidad_id = any(new.unidades))) then
    new.unidad_id := new.unidades[1];
  end if;
  return new;
end $$;
drop trigger if exists perfil_unidades on perfiles;
create trigger perfil_unidades before insert or update on perfiles
  for each row execute function tg_perfil_unidades();

create or replace function unidades_actuales() returns uuid[]
language sql stable security definer set search_path = public as $$
  select unidades from perfiles where user_id = usuario_sesion() and activo
$$;

-- El admin ve y graba en todas las unidades; capturador e invitado, en las suyas.
create or replace function unidad_permitida(p_unidad uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(rol_actual() = 'admin', false)
      or (p_unidad is not null and p_unidad = any(coalesce(unidades_actuales(), '{}')))
$$;

revoke execute on function unidades_actuales() from public;
grant execute on function unidades_actuales() to authenticated;

-- ===== 018_capturador_autonomo.sql =====
-- Capturador autónomo (07/11/2026): el capturador avanza y retrocede los estados sin
-- depender del administrador (aprobar, esperar repuestos, programar, reprogramar,
-- ejecutar, validar, rechazar y anular) y edita el backlog mientras está abierto.
-- Una vez Validado, Rechazado o Anulado, el backlog queda bloqueado para el
-- capturador: solo el administrador lo revierte o lo borra.
-- Cada retroceso pide motivo y queda en la bitácora. Se puede repetir.
--
-- Flujo:
--   Identificado         -> En planificación | Rechazado | Anulado
--   En planificación     -> Esperando repuestos | Listo para programar | Identificado (atrás) | Anulado
--   Esperando repuestos  -> Listo para programar | En planificación (atrás) | Anulado
--   Listo para programar -> Programado | En planificación (atrás) | Anulado
--   Programado           -> Ejecutado | Programado (reprogramar) | Listo para programar (atrás) | Anulado
--   Ejecutado            -> Validado | Programado (atrás)
--   Validado             -> Ejecutado (atrás, solo admin)
--   Rechazado, Anulado   -> Identificado (reabrir, solo admin)

create or replace function cambiar_estado_backlog(p_id uuid, p_estado text, p_datos jsonb default '{}'::jsonb)
returns backlogs
language plpgsql security definer set search_path = public as $$
declare
  b           backlogs;
  v_rol       text := rol_actual();
  v_motivo    text := nullif(trim(p_datos->>'motivo'), '');
  v_coment    text := nullif(trim(p_datos->>'comentario'), '');
  v_tipo_ev   text := 'estado';
  v_pend      integer;
  v_total     integer;
  v_fecha     date;
  v_semana    date;
  v_anterior  text;
  v_detalle   text;
  v_fecha_ant date;
  v_atras     boolean;
begin
  select * into b from backlogs where id = p_id for update;
  if not found then
    raise exception 'Backlog inexistente';
  end if;
  if b.borrado_en is not null then
    raise exception 'El backlog % está borrado: no se edita', b.folio;
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

  if not (
       (b.estado = 'Identificado'         and p_estado in ('En planificación','Rechazado','Anulado'))
    or (b.estado = 'En planificación'     and p_estado in ('Esperando repuestos','Listo para programar','Identificado','Anulado'))
    or (b.estado = 'Esperando repuestos'  and p_estado in ('Listo para programar','En planificación','Anulado'))
    or (b.estado = 'Listo para programar' and p_estado in ('Programado','En planificación','Anulado'))
    or (b.estado = 'Programado'           and p_estado in ('Ejecutado','Listo para programar','Programado','Anulado'))
    or (b.estado = 'Ejecutado'            and p_estado in ('Validado','Programado'))
    or (b.estado = 'Validado'             and p_estado = 'Ejecutado')
    or (b.estado in ('Rechazado','Anulado') and p_estado = 'Identificado')
  ) then
    raise exception 'No se puede pasar de % a %', b.estado, p_estado;
  end if;

  -- Validado, Rechazado y Anulado quedan bloqueados para el capturador.
  if v_rol <> 'admin' and b.estado in ('Validado','Rechazado','Anulado') then
    raise exception 'El backlog está %: solo el administrador puede revertirlo', b.estado;
  end if;

  -- Retrocesos: piden motivo.
  v_atras := (b.estado = 'En planificación' and p_estado = 'Identificado')
          or (b.estado in ('Esperando repuestos','Listo para programar') and p_estado = 'En planificación')
          or (b.estado = 'Programado' and p_estado = 'Listo para programar')
          or (b.estado = 'Ejecutado' and p_estado = 'Programado')
          or (b.estado = 'Validado' and p_estado = 'Ejecutado')
          or (b.estado in ('Rechazado','Anulado') and p_estado = 'Identificado');
  if v_atras and v_motivo is null then
    raise exception 'Indique el motivo para volver a %', p_estado;
  end if;

  perform set_config('backlog.transicion', 'si', true);

  if p_datos ? 'prioridad' and b.estado in ('Identificado','En planificación') then
    b.prioridad := p_datos->>'prioridad';
  end if;

  case p_estado
    when 'Identificado' then
      -- Reabrir un rechazado o anulado, o volver desde planificación.
      b.motivo_anulacion := null;
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
      if v_pend > 0 and b.estado <> 'Programado' then
        raise exception 'Faltan % repuesto(s) por recibir', v_pend;
      end if;
      if b.estado = 'Programado' then
        b.reprogramaciones := b.reprogramaciones + 1;
        b.semana_programada := null;
        b.fecha_programada := null;
        v_tipo_ev := 'reprogramación';
      end if;
    when 'Programado' then
      if b.estado = 'Ejecutado' then
        -- Vuelve a programado: se borra la fecha de ejecución; fecha y OT se mantienen.
        b.fecha_ejecucion := null;
      else
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
          raise exception 'Para programar indique fecha programada y N° de OT';
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
      end if;
    when 'Ejecutado' then
      if b.estado = 'Programado' then
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
      end if;
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
  values (b.id, v_tipo_ev, v_anterior, p_estado,
          nullif(concat_ws(' · ', case when v_atras then 'Retroceso' end, v_detalle, v_motivo, v_coment), ''));

  perform set_config('backlog.transicion', 'no', true);
  return b;
end $$;

revoke execute on function cambiar_estado_backlog(uuid, text, jsonb) from public;
grant execute on function cambiar_estado_backlog(uuid, text, jsonb) to authenticated;

-- Editar el backlog: el capturador mientras esté abierto (antes solo en Identificado).
drop policy if exists editar_backlogs on backlogs;
create policy editar_backlogs on backlogs for update to authenticated
  using (unidad_permitida(unidad_id)
         and (rol_actual() = 'admin'
              or (rol_actual() = 'capturador' and estado not in ('Validado','Rechazado','Anulado'))))
  with check (unidad_permitida(unidad_id));

-- Borrar: el capturador no borra un backlog Validado (solo el administrador).
create or replace function borrar_backlog(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_rol  text := rol_actual();
  b      backlogs;
begin
  select * into b from backlogs where id = p_id for update;
  if not found then
    raise exception 'Backlog inexistente';
  end if;
  if v_rol is null or v_rol not in ('admin', 'capturador') or not unidad_permitida(b.unidad_id) then
    raise exception 'Solo el administrador o un capturador de la unidad pueden borrar el backlog %', b.folio;
  end if;
  if v_rol <> 'admin' and b.estado = 'Validado' then
    raise exception 'El backlog % está Validado: solo el administrador puede borrarlo', b.folio;
  end if;
  if b.borrado_en is not null then
    raise exception 'El backlog % ya está borrado', b.folio;
  end if;
  if length(coalesce(trim(p_motivo), '')) < 5 then
    raise exception 'Indique el motivo del borrado (mínimo 5 letras)';
  end if;
  perform set_config('backlog.borrado', 'si', true);
  perform set_config('backlog.transicion', 'si', true);
  update backlogs
     set borrado_en = now(), borrado_por = usuario_sesion(), motivo_borrado = trim(p_motivo)
   where id = p_id;
  perform set_config('backlog.transicion', 'no', true);
  perform set_config('backlog.borrado', 'no', true);
  insert into backlog_eventos (backlog_id, tipo, estado_anterior, texto, usuario)
  values (p_id, 'borrado', b.estado, 'Borrado: ' || trim(p_motivo), usuario_sesion());
end $$;

-- ===== 019_programar_fecha_pasada.sql =====
-- Programar y reprogramar con fecha anterior a hoy (10/11/2026): se puede registrar
-- una programación pasada, pero no antes de la fecha en que se reportó el backlog
-- (fecha_deteccion). Cambia solo esa validación de cambiar_estado_backlog (018).
-- Se puede repetir.
do $$
declare
  f text;
begin
  select pg_get_functiondef(p.oid) into f
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'cambiar_estado_backlog';
  f := replace(f, 'if v_fecha < hoy() then', 'if v_fecha < b.fecha_deteccion then');
  f := replace(f, $t$raise exception 'La fecha programada no puede ser pasada';$t$,
    $t$raise exception 'La fecha programada no puede ser anterior a la fecha de detección (%)', to_char(b.fecha_deteccion, 'DD/MM/YYYY');$t$);
  execute f;
end $$;

-- ===== 020_repuestos_hasta_listo.sql =====
-- Materiales (backlog_repuestos): se agregan, editan y quitan hasta «Listo para
-- programar». Con el backlog Programado o Ejecutado quedan bloqueados (Validado,
-- Rechazado y Anulado ya lo estaban por tg_detalle_editable). Para cambiarlos se
-- vuelve el backlog a Listo para programar. Se puede repetir.
create or replace function tg_repuestos_hasta_listo() returns trigger
language plpgsql as $$
declare
  v_id     uuid;
  v_estado text;
begin
  if tg_op = 'DELETE' then v_id := old.backlog_id; else v_id := new.backlog_id; end if;
  select estado into v_estado from backlogs where id = v_id;
  if v_estado in ('Programado', 'Ejecutado') then
    raise exception 'Con el backlog % los materiales no se editan; vuélvalo a Listo para programar para cambiarlos', v_estado;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists repuestos_hasta_listo on backlog_repuestos;
create trigger repuestos_hasta_listo before insert or update or delete on backlog_repuestos
  for each row execute function tg_repuestos_hasta_listo();

-- ===== 021_preventivos.sql =====
-- Preventivos programados a mano (10/11/2026) y numeración automática de OT.
-- Un preventivo no es un backlog: no lleva prioridad, sistema ni HH y no entra en los
-- indicadores de backlog. Estados: Programado, Ejecutado, Anulado. Al cerrar se cargan
-- los materiales utilizados. Las pautas y los kits quedan fuera de la app.
-- En las unidades sin SAP la base asigna el N° de OT (OT-<sigla>-<n>) a preventivos y
-- a backlogs que se programan sin OT escrita. Se puede repetir.

-- Correlativos por unidad: PM (folio del preventivo), OT (orden de trabajo), PQ (paquete).
create table if not exists correlativos (
  unidad_id  uuid not null references unidades(id),
  clase      text not null check (clase in ('PM','OT','PQ')),
  ultimo     integer not null default 0,
  primary key (unidad_id, clase)
);
alter table correlativos enable row level security;

create or replace function siguiente_correlativo(p_unidad uuid, p_clase text) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_sigla text;
  v_num   integer;
begin
  select sigla into v_sigla from unidades where id = p_unidad;
  if v_sigla is null then
    raise exception 'Unidad inexistente';
  end if;
  insert into correlativos (unidad_id, clase, ultimo) values (p_unidad, p_clase, 1)
  on conflict (unidad_id, clase) do update set ultimo = correlativos.ultimo + 1
  returning ultimo into v_num;
  return format('%s-%s-%s', p_clase, v_sigla, lpad(v_num::text, 6, '0'));
end $$;
revoke execute on function siguiente_correlativo(uuid, text) from public, anon, authenticated;

create table if not exists preventivos (
  id                    uuid primary key default gen_random_uuid(),
  folio                 text not null unique,            -- PM-EXP-000012, lo pone el disparador
  unidad_id             uuid not null references unidades(id),
  equipo_id             uuid not null references equipos(id),
  actividad             text not null check (length(trim(actividad)) >= 3),
  fecha_programada      date not null,
  horometro_programado  numeric check (horometro_programado >= 0),
  n_ot                  text,
  observaciones         text,
  estado                text not null default 'Programado' check (estado in ('Programado','Ejecutado','Anulado')),
  fecha_ejecucion       date,
  horometro_ejecucion   numeric check (horometro_ejecucion >= 0),
  ejecutado_por         text,
  comentario_cierre     text,
  reprogramaciones      integer not null default 0,
  motivo_anulacion      text,
  creado_por            uuid default usuario_sesion(),
  creado_en             timestamptz not null default now(),
  actualizado_en        timestamptz not null default now()
);
create index if not exists preventivos_unidad_fecha on preventivos (unidad_id, fecha_programada);
create index if not exists preventivos_equipo on preventivos (equipo_id);

create table if not exists preventivo_materiales (
  id             uuid primary key default gen_random_uuid(),
  preventivo_id  uuid not null references preventivos(id) on delete cascade,
  item           integer,
  numero_parte   text,
  cod_sap        text,
  descripcion    text not null check (length(trim(descripcion)) >= 2),
  cantidad       numeric not null check (cantidad > 0),
  um             text,
  observaciones  text,
  creado_por     uuid default usuario_sesion(),
  creado_en      timestamptz not null default now()
);
create index if not exists preventivo_materiales_preventivo on preventivo_materiales (preventivo_id);

create table if not exists preventivo_eventos (
  id             uuid primary key default gen_random_uuid(),
  preventivo_id  uuid not null references preventivos(id) on delete cascade,
  tipo           text not null check (tipo in ('registro','reprogramación','ejecución','anulación','reversión')),
  texto          text,
  usuario        uuid default usuario_sesion(),
  creado_en      timestamptz not null default now()
);
create index if not exists preventivo_eventos_preventivo on preventivo_eventos (preventivo_id, creado_en);

create or replace function unidad_de_preventivo(p_id uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select unidad_id from preventivos where id = p_id
$$;
grant execute on function unidad_de_preventivo(uuid) to authenticated;

-- Alta: unidad del equipo, folio, estado inicial y N° de OT (escrita en las unidades con
-- SAP, automática en las demás si no se escribió).
create or replace function tg_preventivo_alta() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_sap boolean;
begin
  select e.unidad_id, u.usa_sap into new.unidad_id, v_sap
  from equipos e join unidades u on u.id = e.unidad_id
  where e.id = new.equipo_id;
  if new.unidad_id is null then
    raise exception 'Equipo inexistente';
  end if;
  new.n_ot := nullif(trim(new.n_ot), '');
  if new.n_ot is null then
    if v_sap then
      raise exception 'Para programar el preventivo indique la OT de SAP';
    end if;
    new.n_ot := siguiente_correlativo(new.unidad_id, 'OT');
  end if;
  new.folio := siguiente_correlativo(new.unidad_id, 'PM');
  new.actividad := trim(new.actividad);
  new.estado := 'Programado';
  new.fecha_ejecucion := null;
  new.horometro_ejecucion := null;
  new.reprogramaciones := 0;
  new.motivo_anulacion := null;
  new.creado_por := usuario_sesion();
  new.creado_en := now();
  new.actualizado_en := now();
  return new;
end $$;
drop trigger if exists preventivo_alta on preventivos;
create trigger preventivo_alta before insert on preventivos
  for each row execute function tg_preventivo_alta();

create or replace function tg_preventivo_evento_alta() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into preventivo_eventos (preventivo_id, tipo, texto, usuario)
  values (new.id, 'registro', format('Programado para el %s', to_char(new.fecha_programada, 'DD/MM/YYYY')), new.creado_por);
  return null;
end $$;
drop trigger if exists preventivo_evento_alta on preventivos;
create trigger preventivo_evento_alta after insert on preventivos
  for each row execute function tg_preventivo_evento_alta();

-- Edición directa: solo con el preventivo Programado y solo actividad, horómetro
-- programado, observaciones y N° de OT. Lo demás cambia con cambiar_estado_preventivo().
create or replace function tg_preventivo_cambio() returns trigger
language plpgsql as $$
begin
  new.actualizado_en := now();
  if coalesce(current_setting('preventivo.transicion', true), '') = 'si' then
    return new;
  end if;
  if old.estado <> 'Programado' then
    raise exception 'El preventivo % está %: no se edita', old.folio, old.estado;
  end if;
  if to_jsonb(new) - 'actividad' - 'horometro_programado' - 'observaciones' - 'n_ot' - 'actualizado_en'
     <> to_jsonb(old) - 'actividad' - 'horometro_programado' - 'observaciones' - 'n_ot' - 'actualizado_en' then
    raise exception 'La fecha y el estado del preventivo se cambian con Reprogramar, Ejecutar o Anular';
  end if;
  new.n_ot := nullif(trim(new.n_ot), '');
  if new.n_ot is null then
    raise exception 'El preventivo no puede quedar sin N° de OT';
  end if;
  return new;
end $$;
drop trigger if exists preventivo_cambio on preventivos;
create trigger preventivo_cambio before update on preventivos
  for each row execute function tg_preventivo_cambio();

-- Materiales: ítem correlativo; se editan con el preventivo Programado. Con Ejecutado o
-- Anulado solo el administrador.
create or replace function tg_preventivo_material() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_id     uuid;
  v_estado text;
begin
  if tg_op = 'DELETE' then v_id := old.preventivo_id; else v_id := new.preventivo_id; end if;
  select estado into v_estado from preventivos where id = v_id;
  if v_estado is not null and v_estado <> 'Programado' and coalesce(rol_actual(), '') <> 'admin' then
    raise exception 'El preventivo está %: solo el administrador cambia sus materiales', v_estado;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if tg_op = 'INSERT' and new.item is null then
    select coalesce(max(item), 0) + 1 into new.item from preventivo_materiales where preventivo_id = new.preventivo_id;
  end if;
  return new;
end $$;
drop trigger if exists preventivo_material on preventivo_materiales;
create trigger preventivo_material before insert or update or delete on preventivo_materiales
  for each row execute function tg_preventivo_material();

-- Transiciones:
--   Programado -> Programado (reprogramar, con motivo) | Ejecutado | Anulado (con motivo)
--   Ejecutado  -> Programado (solo admin, con motivo)
--   Anulado    -> Programado (solo admin, con motivo)
create or replace function cambiar_estado_preventivo(p_id uuid, p_estado text, p_datos jsonb default '{}'::jsonb)
returns preventivos
language plpgsql security definer set search_path = public as $$
declare
  p         preventivos;
  v_rol     text := rol_actual();
  v_motivo  text := nullif(trim(p_datos->>'motivo'), '');
  v_fecha   date;
  v_tipo    text;
  v_texto   text;
begin
  select * into p from preventivos where id = p_id for update;
  if not found then
    raise exception 'Preventivo inexistente';
  end if;
  if v_rol is null or v_rol not in ('admin','capturador') or not unidad_permitida(p.unidad_id) then
    raise exception 'Sin permiso para cambiar este preventivo';
  end if;
  if p.estado <> 'Programado' and v_rol <> 'admin' then
    raise exception 'El preventivo % está %: solo el administrador puede revertirlo', p.folio, p.estado;
  end if;

  if p.estado = 'Programado' and p_estado = 'Programado' then
    v_fecha := (p_datos->>'fecha_programada')::date;
    if v_motivo is null then
      raise exception 'Indique el motivo de la reprogramación';
    end if;
    if v_fecha is null or v_fecha = p.fecha_programada then
      raise exception 'Indique una fecha programada distinta a la actual';
    end if;
    v_tipo := 'reprogramación';
    v_texto := format('%s → %s · %s', to_char(p.fecha_programada, 'DD/MM/YYYY'), to_char(v_fecha, 'DD/MM/YYYY'), v_motivo);
    p.fecha_programada := v_fecha;
    p.reprogramaciones := p.reprogramaciones + 1;
  elsif p.estado = 'Programado' and p_estado = 'Ejecutado' then
    v_fecha := (p_datos->>'fecha_ejecucion')::date;
    if v_fecha is null then
      raise exception 'Indique la fecha de ejecución';
    end if;
    if v_fecha > hoy() then
      raise exception 'La fecha de ejecución no puede ser futura';
    end if;
    p.fecha_ejecucion := v_fecha;
    p.horometro_ejecucion := nullif(trim(p_datos->>'horometro_ejecucion'), '')::numeric;
    p.ejecutado_por := nullif(trim(p_datos->>'ejecutado_por'), '');
    p.comentario_cierre := nullif(trim(p_datos->>'comentario'), '');
    p.estado := 'Ejecutado';
    v_tipo := 'ejecución';
    v_texto := concat_ws(' · ', format('Ejecutado el %s', to_char(v_fecha, 'DD/MM/YYYY')),
                         'horómetro ' || p.horometro_ejecucion::text, p.ejecutado_por, p.comentario_cierre);
  elsif p.estado = 'Programado' and p_estado = 'Anulado' then
    if v_motivo is null then
      raise exception 'Indique el motivo de la anulación';
    end if;
    p.estado := 'Anulado';
    p.motivo_anulacion := v_motivo;
    v_tipo := 'anulación';
    v_texto := v_motivo;
  elsif p.estado in ('Ejecutado','Anulado') and p_estado = 'Programado' then
    if v_motivo is null then
      raise exception 'Indique el motivo para volver el preventivo a Programado';
    end if;
    v_tipo := 'reversión';
    v_texto := format('%s → Programado · %s', p.estado, v_motivo);
    p.estado := 'Programado';
    p.fecha_ejecucion := null;
    p.motivo_anulacion := null;
  else
    raise exception 'Cambio no permitido: % → %', p.estado, p_estado;
  end if;

  perform set_config('preventivo.transicion', 'si', true);
  update preventivos set
    estado = p.estado,
    fecha_programada = p.fecha_programada,
    reprogramaciones = p.reprogramaciones,
    fecha_ejecucion = p.fecha_ejecucion,
    horometro_ejecucion = p.horometro_ejecucion,
    ejecutado_por = p.ejecutado_por,
    comentario_cierre = p.comentario_cierre,
    motivo_anulacion = p.motivo_anulacion
  where id = p.id
  returning * into p;
  perform set_config('preventivo.transicion', '', true);

  insert into preventivo_eventos (preventivo_id, tipo, texto, usuario)
  values (p.id, v_tipo, v_texto, usuario_sesion());
  return p;
end $$;
grant execute on function cambiar_estado_preventivo(uuid, text, jsonb) to authenticated;

-- Políticas: lee cualquier perfil activo de la unidad; escribe admin o capturador.
alter table preventivos enable row level security;
alter table preventivo_materiales enable row level security;
alter table preventivo_eventos enable row level security;

drop policy if exists leer_preventivos on preventivos;
create policy leer_preventivos on preventivos for select to authenticated
  using (rol_actual() is not null and unidad_permitida(unidad_id));
drop policy if exists registrar_preventivos on preventivos;
create policy registrar_preventivos on preventivos for insert to authenticated
  with check (rol_actual() in ('admin','capturador') and unidad_permitida(unidad_id));
drop policy if exists editar_preventivos on preventivos;
create policy editar_preventivos on preventivos for update to authenticated
  using (rol_actual() in ('admin','capturador') and unidad_permitida(unidad_id))
  with check (rol_actual() in ('admin','capturador') and unidad_permitida(unidad_id));

drop policy if exists leer_preventivo_materiales on preventivo_materiales;
create policy leer_preventivo_materiales on preventivo_materiales for select to authenticated
  using (rol_actual() is not null and unidad_permitida(unidad_de_preventivo(preventivo_id)));
drop policy if exists editar_preventivo_materiales on preventivo_materiales;
create policy editar_preventivo_materiales on preventivo_materiales for all to authenticated
  using (rol_actual() in ('admin','capturador') and unidad_permitida(unidad_de_preventivo(preventivo_id)))
  with check (rol_actual() in ('admin','capturador') and unidad_permitida(unidad_de_preventivo(preventivo_id)));

drop policy if exists leer_preventivo_eventos on preventivo_eventos;
create policy leer_preventivo_eventos on preventivo_eventos for select to authenticated
  using (rol_actual() is not null and unidad_permitida(unidad_de_preventivo(preventivo_id)));

grant select, insert, update on preventivos to authenticated;
grant select, insert, update, delete on preventivo_materiales to authenticated;
grant select on preventivo_eventos to authenticated;

drop view if exists v_preventivos;
create view v_preventivos as
select p.*,
       e.cod_interno, e.modelo, e.marca, coalesce(f.nombre, e.flota) as flota,
       u.nombre as unidad, u.usa_sap,
       (select count(*) from preventivo_materiales m where m.preventivo_id = p.id)::integer as materiales_total
from preventivos p
join equipos e  on e.id = p.equipo_id
join unidades u on u.id = p.unidad_id
left join familias f on f.id = e.familia_id;
alter view v_preventivos set (security_invoker = true);
grant select on v_preventivos to authenticated;

-- N° de OT automático al programar un backlog en una unidad sin SAP (cambia solo esa
-- línea de cambiar_estado_backlog, 018). Las OT ya escritas no se tocan.
do $$
declare
  f text;
  v_linea text := $t$b.ot_sap := coalesce(nullif(trim(p_datos->>'ot_sap'), ''), b.ot_sap);$t$;
begin
  select pg_get_functiondef(p.oid) into f
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'cambiar_estado_backlog';
  if position('siguiente_correlativo' in f) = 0 then
    if position(v_linea in f) = 0 then
      raise exception 'cambiar_estado_backlog no tiene la línea esperada de la OT';
    end if;
    f := replace(f, v_linea, v_linea || $t$
        if b.ot_sap is null and v_fecha is not null
           and not (select usa_sap from unidades where id = b.unidad_id) then
          b.ot_sap := siguiente_correlativo(b.unidad_id, 'OT');
        end if;$t$);
    execute f;
  end if;
end $$;

-- Tiempo real de Supabase.
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['preventivos','preventivo_materiales','preventivo_eventos'] loop
      if not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table %I', t);
      end if;
    end loop;
  end if;
end $$;

-- ===== 022_paquetes.sql =====
-- Paquetes de órdenes de trabajo (11/11/2026): todo lo programado para un equipo en un
-- día (preventivos y correctivos). El paquete solo guarda su número (PQ-<sigla>-<n>);
-- la lista de órdenes se calcula, así una orden reprogramada sale sola del paquete.
-- Se puede repetir.

create table if not exists paquetes (
  id          uuid primary key default gen_random_uuid(),
  folio       text not null unique,
  unidad_id   uuid not null references unidades(id),
  equipo_id   uuid not null references equipos(id),
  fecha       date not null,
  creado_por  uuid default usuario_sesion(),
  creado_en   timestamptz not null default now(),
  impreso_en  timestamptz,
  impresiones integer not null default 0,
  unique (equipo_id, fecha)
);
create index if not exists paquetes_unidad_fecha on paquetes (unidad_id, fecha);

alter table paquetes enable row level security;
drop policy if exists leer_paquetes on paquetes;
create policy leer_paquetes on paquetes for select to authenticated
  using (rol_actual() is not null and unidad_permitida(unidad_id));
grant select on paquetes to authenticated;

-- Devuelve el paquete del equipo y día; lo crea con su número la primera vez. Cada
-- llamada cuenta como una impresión.
create or replace function paquete_de(p_equipo uuid, p_fecha date) returns paquetes
language plpgsql security definer set search_path = public as $$
declare
  q         paquetes;
  v_unidad  uuid;
  v_rol     text := rol_actual();
begin
  select unidad_id into v_unidad from equipos where id = p_equipo;
  if v_unidad is null then
    raise exception 'Equipo inexistente';
  end if;
  if v_rol is null or v_rol not in ('admin','capturador') or not unidad_permitida(v_unidad) then
    raise exception 'Sin permiso para armar paquetes de este equipo';
  end if;
  if p_fecha is null then
    raise exception 'Indique la fecha del paquete';
  end if;
  if not exists (select 1 from backlogs b
                 where b.equipo_id = p_equipo and b.fecha_programada = p_fecha and b.borrado_en is null
                   and b.estado in ('Programado','Ejecutado','Validado'))
     and not exists (select 1 from preventivos p
                     where p.equipo_id = p_equipo and p.fecha_programada = p_fecha and p.estado <> 'Anulado') then
    raise exception 'No hay órdenes programadas para ese equipo el %', to_char(p_fecha, 'DD/MM/YYYY');
  end if;
  select * into q from paquetes where equipo_id = p_equipo and fecha = p_fecha for update;
  if not found then
    insert into paquetes (folio, unidad_id, equipo_id, fecha, creado_por, impreso_en, impresiones)
    values (siguiente_correlativo(v_unidad, 'PQ'), v_unidad, p_equipo, p_fecha, usuario_sesion(), now(), 1)
    returning * into q;
  else
    update paquetes set impreso_en = now(), impresiones = impresiones + 1 where id = q.id returning * into q;
  end if;
  return q;
end $$;
grant execute on function paquete_de(uuid, date) to authenticated;

drop view if exists v_paquetes;
create view v_paquetes as
select q.*, e.cod_interno, e.modelo, u.nombre as unidad,
       (select count(*) from backlogs b
         where b.equipo_id = q.equipo_id and b.fecha_programada = q.fecha and b.borrado_en is null
           and b.estado in ('Programado','Ejecutado','Validado'))::integer as correctivos,
       (select count(*) from backlogs b
         where b.equipo_id = q.equipo_id and b.fecha_programada = q.fecha and b.borrado_en is null
           and b.estado in ('Ejecutado','Validado'))::integer as correctivos_ejecutados,
       (select count(*) from preventivos p
         where p.equipo_id = q.equipo_id and p.fecha_programada = q.fecha and p.estado <> 'Anulado')::integer as preventivos,
       (select count(*) from preventivos p
         where p.equipo_id = q.equipo_id and p.fecha_programada = q.fecha and p.estado = 'Ejecutado')::integer as preventivos_ejecutados
from paquetes q
join equipos e  on e.id = q.equipo_id
join unidades u on u.id = q.unidad_id;
alter view v_paquetes set (security_invoker = true);
grant select on v_paquetes to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'paquetes') then
    alter publication supabase_realtime add table paquetes;
  end if;
end $$;

-- ===== 023_ejecucion_futura.sql =====
-- Ejecución con fecha futura (11/11/2026): "Marcar ejecutado" admite fechas anteriores y
-- posteriores a hoy. En un backlog la fecha de ejecución no puede ser anterior a su
-- fecha de detección; en un preventivo no hay límite. Cambia solo esa validación de
-- cambiar_estado_backlog (018) y cambiar_estado_preventivo (021). Se puede repetir.
do $$
declare
  f text;
  v_viejo text := $t$if v_fecha > hoy() then
          raise exception 'La fecha de ejecución no puede ser futura';
        end if;$t$;
begin
  select pg_get_functiondef(p.oid) into f
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'cambiar_estado_backlog';
  if position('anterior a la fecha de detección (%)'', to_char(b.fecha_deteccion' in f) = 0
     or position('no puede ser futura' in f) > 0 then
    if position(v_viejo in f) = 0 then
      raise exception '023: cambiar_estado_backlog no tiene la validación esperada de la fecha de ejecución';
    end if;
    f := replace(f, v_viejo, $t$if v_fecha < b.fecha_deteccion then
          raise exception 'La fecha de ejecución no puede ser anterior a la fecha de detección (%)', to_char(b.fecha_deteccion, 'DD/MM/YYYY');
        end if;$t$);
    execute f;
  end if;
end $$;

do $$
declare
  f text;
  v_viejo text := $t$    if v_fecha > hoy() then
      raise exception 'La fecha de ejecución no puede ser futura';
    end if;
$t$;
begin
  select pg_get_functiondef(p.oid) into f
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'cambiar_estado_preventivo';
  if position('no puede ser futura' in f) > 0 then
    if position(v_viejo in f) = 0 then
      raise exception '023: cambiar_estado_preventivo no tiene la validación esperada de la fecha de ejecución';
    end if;
    execute replace(f, v_viejo, '');
  end if;
end $$;
