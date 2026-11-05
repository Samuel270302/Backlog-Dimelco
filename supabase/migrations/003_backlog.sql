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
