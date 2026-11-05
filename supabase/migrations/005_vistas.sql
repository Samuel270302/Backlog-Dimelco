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
