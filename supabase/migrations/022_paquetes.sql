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
