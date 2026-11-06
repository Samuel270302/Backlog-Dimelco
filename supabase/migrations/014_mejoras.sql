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
