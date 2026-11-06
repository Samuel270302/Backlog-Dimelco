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
