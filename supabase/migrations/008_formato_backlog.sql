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
