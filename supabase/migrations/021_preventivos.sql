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
