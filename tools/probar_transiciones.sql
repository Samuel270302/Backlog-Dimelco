-- Prueba del flujo y de los permisos por rol y unidad (base local con base_local.sql
-- y las migraciones aplicadas). Termina con error ante la primera falla.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
\o /dev/null

create schema if not exists pruebas;
grant usage on schema pruebas to authenticated;

-- Ejecuta p_sql y exige que falle con un mensaje que contenga p_fragmento.
create or replace function pruebas.espera_error(p_sql text, p_fragmento text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if position(lower(p_fragmento) in lower(sqlerrm)) = 0 then
      raise exception 'Falló con otro mensaje. Esperado «%», recibido «%»', p_fragmento, sqlerrm;
    end if;
    return;
  end;
  raise exception 'Debió fallar: %', p_sql;
end $$;
create or replace function pruebas.igual(p_obtenido anyelement, p_esperado anyelement, p_que text) returns void
language plpgsql as $$
begin
  if p_obtenido is distinct from p_esperado then
    raise exception '%: esperado %, obtenido %', p_que, p_esperado, p_obtenido;
  end if;
end $$;
grant execute on all functions in schema pruebas to authenticated;

-- Datos: fecha fija, usuarios por rol y unidad, equipos, capacidad.
update parametros set valor_texto = '2026-11-02' where clave = 'fecha_referencia';  -- lunes

-- 010: no queda el estado «Cerrado» en funciones ni vistas.
select pruebas.igual((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f' and case when p.prokind = 'f' then pg_get_functiondef(p.oid) end like '%''Cerrado''%'), 0, 'funciones sin Cerrado');
select pruebas.igual((select count(*)::int from pg_views where schemaname = 'public' and definition like '%''Cerrado''%'), 0, 'vistas sin Cerrado');
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@prueba', '{"nombre":"Admin"}'),
  ('00000000-0000-0000-0000-00000000000c', 'cap.hem@prueba', '{"nombre":"Capturador HEMCO"}'),
  ('00000000-0000-0000-0000-00000000000d', 'cap.vtn@prueba', '{"nombre":"Capturador Veta Nueva"}'),
  ('00000000-0000-0000-0000-00000000000e', 'inv.hem@prueba', '{"nombre":"Invitado HEMCO"}');
select pruebas.igual((select count(*) from perfiles where not activo)::int, 4, 'perfiles nacen inactivos');
update perfiles set rol = 'admin', activo = true where correo = 'admin@prueba';
update perfiles set activo = true, unidad_id = (select id from unidades where sigla = 'HEM') where correo = 'cap.hem@prueba';
update perfiles set activo = true, unidad_id = (select id from unidades where sigla = 'VTN') where correo = 'cap.vtn@prueba';
update perfiles set rol = 'invitado', activo = true, unidad_id = (select id from unidades where sigla = 'HEM') where correo = 'inv.hem@prueba';

insert into equipos (id, unidad_id, cod_interno, modelo, flota) values
  ('10000000-0000-0000-0000-000000000001', (select id from unidades where sigla = 'HEM'), 'Scooptram #1', 'ST1030', 'Scooptram'),
  ('10000000-0000-0000-0000-000000000002', (select id from unidades where sigla = 'VTN'), 'Scooptram #1', 'ST7', 'Scooptram');
insert into capacidad_taller (unidad_id, especialidad_id, hh_semana, vigente_desde)
select u.id, e.id, 100, '2026-01-01' from unidades u, especialidades e where u.sigla = 'HEM' and e.nombre in ('Mecánico','Eléctrico');

set role authenticated;

-- Capturador HEMCO registra un backlog.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c"}', false);
insert into backlogs (id, equipo_id, sistema_id, descripcion, origen, prioridad, fecha_deteccion, reportado_por, aprobado_por)
values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
        (select id from sistemas where nombre = 'Sistema hidráulico'),
        'Fuga en cilindro de levante lado izquierdo', 'Inspección', 'P2', '2026-10-30', 'J. Pérez', 'M. López');
select pruebas.igual((select folio from backlogs where id = '20000000-0000-0000-0000-000000000001'), 'BL-HEM-000001', 'folio');
select pruebas.igual((select fecha_limite from backlogs where id = '20000000-0000-0000-0000-000000000001'), date '2026-11-02', 'fecha límite P2 (3 días)');
select pruebas.igual((select count(*) from backlog_eventos)::int, 1, 'evento de registro');
insert into backlog_hh (backlog_id, especialidad_id, tipo, personas, horas)
values ('20000000-0000-0000-0000-000000000001', (select id from especialidades where nombre = 'Mecánico'), 'estimada', 2, 4);
update backlogs set descripcion = 'Fuga en cilindro de levante izquierdo, sello dañado' where id = '20000000-0000-0000-0000-000000000001';
select pruebas.espera_error($$update backlogs set estado = 'Programado' where id = '20000000-0000-0000-0000-000000000001'$$, 'cambiar_estado_backlog');
select pruebas.espera_error($$insert into backlogs (equipo_id, sistema_id, descripcion, origen, prioridad, reportado_por, aprobado_por)
  values ('10000000-0000-0000-0000-000000000002', (select id from sistemas limit 1), 'Equipo de otra unidad', 'PM', 'P3', 'A', 'B')$$, 'row-level security');
select pruebas.espera_error($$insert into backlogs (equipo_id, sistema_id, descripcion, origen, prioridad, fecha_deteccion, reportado_por, aprobado_por)
  values ('10000000-0000-0000-0000-000000000001', (select id from sistemas limit 1), 'Detección futura', 'PM', 'P3', '2026-12-01', 'A', 'B')$$, 'futura');

-- Capturador Veta Nueva no ve el backlog de HEMCO.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000d"}', false);
select pruebas.igual((select count(*) from v_backlog)::int, 0, 'Veta Nueva no ve HEMCO');
select pruebas.espera_error($$select cambiar_estado_backlog('20000000-0000-0000-0000-000000000001', 'Ejecutado')$$, 'Sin permiso');

-- Invitado ve pero no escribe.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000e"}', false);
select pruebas.igual((select count(*) from v_backlog)::int, 1, 'invitado ve su unidad');
select pruebas.espera_error($$insert into backlog_eventos (backlog_id, tipo, texto, usuario)
  values ('20000000-0000-0000-0000-000000000001', 'comentario', 'hola', usuario_sesion())$$, 'row-level security');
select pruebas.espera_error($$select cambiar_estado_backlog('20000000-0000-0000-0000-000000000001', 'Anulado', '{"motivo":"x"}')$$, 'Sin permiso');

-- Admin planifica, carga repuestos y espera.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a"}', false);
select cambiar_estado_backlog('20000000-0000-0000-0000-000000000001', 'En planificación', '{"prioridad":"P1"}');
select pruebas.igual((select fecha_limite from backlogs where id = '20000000-0000-0000-0000-000000000001'), date '2026-10-31', 'límite recalculado a P1 (24 horas)');
select pruebas.igual((select vencido from v_backlog where id = '20000000-0000-0000-0000-000000000001'), true, 'P1 vencido');
select pruebas.espera_error($$select cambiar_estado_backlog('20000000-0000-0000-0000-000000000001', 'Esperando repuestos')$$, 'No hay repuestos');
insert into backlog_repuestos (id, backlog_id, cod_sap, descripcion, cantidad) values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '100234', 'Kit de sellos cilindro', 1),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '100567', 'Aceite hidráulico ISO 68', 20);
select pruebas.espera_error($$select cambiar_estado_backlog('20000000-0000-0000-0000-000000000001', 'Listo para programar')$$, 'Faltan 2');
select cambiar_estado_backlog('20000000-0000-0000-0000-000000000001', 'Esperando repuestos');
update backlog_repuestos set estado = 'Pedido', solicitud_sap = '10045678' where backlog_id = '20000000-0000-0000-0000-000000000001';
update backlog_repuestos set estado = 'Recibido' where id = '30000000-0000-0000-0000-000000000001';
select pruebas.igual((select estado from backlogs where id = '20000000-0000-0000-0000-000000000001'), 'Esperando repuestos', 'falta uno');
update backlog_repuestos set estado = 'Recibido' where id = '30000000-0000-0000-0000-000000000002';
select pruebas.igual((select estado from backlogs where id = '20000000-0000-0000-0000-000000000001'), 'Listo para programar', 'paso automático a Listo');
select pruebas.igual((select fecha_recibido from backlog_repuestos where id = '30000000-0000-0000-0000-000000000002'), current_date, 'fecha recibido');

-- Programar, reprogramar y volver a programar.
select pruebas.espera_error($$select cambiar_estado_backlog('20000000-0000-0000-0000-000000000001', 'Programado', '{"fecha_programada":"2026-11-04"}')$$, 'N° de OT');
select pruebas.espera_error($$select cambiar_estado_backlog('20000000-0000-0000-0000-000000000001', 'Programado', '{"fecha_programada":"2026-10-28","ot_sap":"4001"}')$$, 'pasada');
select cambiar_estado_backlog('20000000-0000-0000-0000-000000000001', 'Programado', '{"fecha_programada":"2026-11-04","ot_sap":"4001234"}');
select pruebas.igual((select semana_programada from backlogs where id = '20000000-0000-0000-0000-000000000001'), date '2026-11-02', 'semana lunes');
select pruebas.igual((select hh_programadas from v_carga_semanal)::numeric, 8::numeric, 'carga semanal');
select pruebas.espera_error($$select cambiar_estado_backlog('20000000-0000-0000-0000-000000000001', 'Listo para programar')$$, 'motivo');
select cambiar_estado_backlog('20000000-0000-0000-0000-000000000001', 'Listo para programar', '{"motivo":"Equipo en producción, sin parada"}');
select pruebas.igual((select reprogramaciones from backlogs where id = '20000000-0000-0000-0000-000000000001'), 1, 'reprogramaciones');
select cambiar_estado_backlog('20000000-0000-0000-0000-000000000001', 'Programado', '{"fecha_programada":"2026-11-10","ot_sap":"4001234","aprovechar_pm":true}');

-- Reprogramación directa (009): otra fecha y motivo en un solo llamado.
select pruebas.espera_error($$select cambiar_estado_backlog('20000000-0000-0000-0000-000000000001', 'Programado', '{"fecha_programada":"2026-11-10","motivo":"x"}')$$, 'distinta');
select pruebas.espera_error($$select cambiar_estado_backlog('20000000-0000-0000-0000-000000000001', 'Programado', '{"fecha_programada":"2026-11-12"}')$$, 'motivo');
select pruebas.espera_error($$select cambiar_estado_backlog('20000000-0000-0000-0000-000000000001', 'Programado', '{"fecha_programada":"2026-10-30","motivo":"x"}')$$, 'pasada');
select cambiar_estado_backlog('20000000-0000-0000-0000-000000000001', 'Programado', '{"fecha_programada":"2026-11-12","motivo":"Sin parada de producción el martes"}');
select pruebas.igual((select fecha_programada || ' ' || semana_programada || ' ' || reprogramaciones || ' ' || ot_sap
  from backlogs where id = '20000000-0000-0000-0000-000000000001'), '2026-11-12 2026-11-09 2 4001234', 'reprogramado con la misma OT');
select pruebas.igual((select texto from backlog_eventos where backlog_id = '20000000-0000-0000-0000-000000000001'
  order by creado_en desc, id desc limit 1), '10/11/2026 → 12/11/2026 · Sin parada de producción el martes', 'evento de reprogramación');

-- Capturador ejecuta con HH reales; admin cierra.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c"}', false);
select pruebas.espera_error($$select cambiar_estado_backlog('20000000-0000-0000-0000-000000000001', 'Programado', '{"fecha_programada":"2026-11-12","motivo":"x"}')$$, 'distinta');
select pruebas.espera_error($$select cambiar_estado_backlog('20000000-0000-0000-0000-000000000001', 'Ejecutado', '{"fecha_ejecucion":"2026-11-02"}')$$, 'HH reales');
insert into backlog_hh (backlog_id, especialidad_id, tipo, personas, horas)
values ('20000000-0000-0000-0000-000000000001', (select id from especialidades where nombre = 'Mecánico'), 'real', 2, 5);
select pruebas.espera_error($$select cambiar_estado_backlog('20000000-0000-0000-0000-000000000001', 'Ejecutado', '{"fecha_ejecucion":"2026-11-20"}')$$, 'futura');
select cambiar_estado_backlog('20000000-0000-0000-0000-000000000001', 'Ejecutado', '{"fecha_ejecucion":"2026-11-02","comentario":"Se cambiaron sellos"}');
insert into backlog_eventos (backlog_id, tipo, texto) values ('20000000-0000-0000-0000-000000000001', 'comentario', 'Equipo probado OK');
-- 018: el capturador también valida; después ya no lo puede revertir.
select cambiar_estado_backlog('20000000-0000-0000-0000-000000000001', 'Validado');
select pruebas.espera_error($$select cambiar_estado_backlog('20000000-0000-0000-0000-000000000001', 'Ejecutado', '{"motivo":"Revisar"}')$$, 'solo el administrador puede revertirlo');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a"}', false);
select pruebas.espera_error($$update backlogs set descripcion = 'cambio tardío' where id = '20000000-0000-0000-0000-000000000001'$$, 'no se edita');
select pruebas.espera_error($$delete from backlog_hh where backlog_id = '20000000-0000-0000-0000-000000000001'$$, 'no se edita');
select pruebas.igual((select hh_reales from v_backlog where id = '20000000-0000-0000-0000-000000000001'), 10::numeric, 'HH reales');
select pruebas.igual((select antiguedad_dias from v_backlog where id = '20000000-0000-0000-0000-000000000001'), 3, 'antigüedad al ejecutar');
select pruebas.igual((select cierres from v_backlog_semanal where semana = '2026-11-02'), 1::bigint, 'cierre semanal');

-- Semanas de backlog: 3 backlogs abiertos de HEMCO con 30 + 20 + 50 HH mecánicas = 100 HH / 100 HH semana.
insert into backlogs (id, equipo_id, sistema_id, descripcion, origen, prioridad, reportado_por, aprobado_por) values
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', (select id from sistemas where nombre = 'Motor diésel'), 'Cambio de alternador', 'Falla', 'P3', 'A', 'B'),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', (select id from sistemas where nombre = 'Frenos'), 'Regular frenos de servicio', 'PM', 'P4', 'A', 'B'),
  ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', (select id from sistemas where nombre = 'Ruedas y neumáticos'), 'Rotación de llantas', 'Operador', 'P4', 'A', 'B');
insert into backlog_hh (backlog_id, especialidad_id, tipo, personas, horas)
select v.b::uuid, e.id, 'estimada', v.p, v.h
from (values ('20000000-0000-0000-0000-000000000002', 'Mecánico', 3, 10),
             ('20000000-0000-0000-0000-000000000002', 'Eléctrico', 1, 25),
             ('20000000-0000-0000-0000-000000000003', 'Mecánico', 2, 10),
             ('20000000-0000-0000-0000-000000000004', 'Mecánico', 5, 10)) v(b, n, p, h)
join especialidades e on e.nombre = v.n;
select pruebas.igual((select semanas from v_semanas_backlog where especialidad = 'Mecánico'), 1.00::numeric, 'semanas mecánico');
select pruebas.igual((select semanas from v_semanas_backlog where especialidad = 'Eléctrico'), 0.25::numeric, 'semanas eléctrico');
select pruebas.igual((select folio from backlogs where id = '20000000-0000-0000-0000-000000000004'), 'BL-HEM-000004', 'folio correlativo');
select cambiar_estado_backlog('20000000-0000-0000-0000-000000000004', 'Rechazado', '{"motivo":"Duplicado de BL-HEM-000003"}');
select pruebas.igual((select semanas from v_semanas_backlog where especialidad = 'Mecánico'), 0.50::numeric, 'rechazado sale del backlog');

-- Fotos (011): el capturador sube a su unidad pero no borra; el admin borra.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c"}', false);
insert into backlog_fotos (id, backlog_id, ruta) values
  ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'x/20000000-0000-0000-0000-000000000002/a.jpg');
delete from backlog_fotos where id = '40000000-0000-0000-0000-000000000001';
select pruebas.igual((select count(*)::int from backlog_fotos), 1, 'capturador no borra fotos');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000d"}', false);
select pruebas.espera_error($$insert into backlog_fotos (backlog_id, ruta) values
  ('20000000-0000-0000-0000-000000000002', 'x/otra.jpg')$$, 'row-level security');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a"}', false);
delete from backlog_fotos where id = '40000000-0000-0000-0000-000000000001';
select pruebas.igual((select count(*)::int from backlog_fotos), 0, 'admin borra fotos');

-- Plazos (012): el admin recalcula las fechas límite de los abiertos; el capturador no puede.
update parametros set valor = 10 where clave = 'plazo_p4_dias';
select pruebas.igual(recalcular_fechas_limite(), 1, 'recalcula el P4 abierto');
select pruebas.igual((select fecha_limite from backlogs where id = '20000000-0000-0000-0000-000000000003'),
  (select fecha_deteccion + 10 from backlogs where id = '20000000-0000-0000-0000-000000000003'), 'nuevo límite P4');
select pruebas.igual(recalcular_fechas_limite(), 0, 'sin cambios la segunda vez');
update parametros set valor = 40 where clave = 'plazo_p4_dias';
select recalcular_fechas_limite();
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c"}', false);
select pruebas.espera_error($$select recalcular_fechas_limite()$$, 'Solo el administrador');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a"}', false);

-- N° de formato (013): único por unidad.
update backlogs set numero_formato = '105' where id = '20000000-0000-0000-0000-000000000002';
select pruebas.espera_error($$update backlogs set numero_formato = '105' where id = '20000000-0000-0000-0000-000000000003'$$, 'backlogs_numero_formato');
select pruebas.igual((select numero_formato from v_backlog where id = '20000000-0000-0000-0000-000000000002'), '105', 'N° formato en v_backlog');

-- Formato del backlog (008): ítem correlativo, identificación del repuesto, horómetro y tipo de pedido.
select pruebas.igual((select string_agg(item::text, ',' order by item) from backlog_repuestos
  where backlog_id = '20000000-0000-0000-0000-000000000001'), '1,2', 'ítems correlativos');
insert into backlog_repuestos (backlog_id, numero_parte, descripcion, cantidad, stock, componente)
values ('20000000-0000-0000-0000-000000000002', '6060003007', 'Juego de cierres EOD', 2, 0, 'Block de implementos');
select pruebas.igual((select item from backlog_repuestos where numero_parte = '6060003007'), 1, 'ítem 1 en otro backlog');
select pruebas.espera_error($$insert into backlog_repuestos (backlog_id, descripcion, cantidad)
  values ('20000000-0000-0000-0000-000000000002', 'Sin número de parte ni código', 1)$$, 'backlog_repuestos_identificacion');
select pruebas.espera_error($$update backlogs set horometro = -5 where id = '20000000-0000-0000-0000-000000000002'$$, 'backlogs_horometro_check');
select pruebas.espera_error($$update backlogs set tipo_pedido = 'Inmediato' where id = '20000000-0000-0000-0000-000000000002'$$, 'backlogs_tipo_pedido_check');
update backlogs set tipo_pedido = 'Urgente', horometro = 12450.5, componente = 'Block de implementos',
  justificacion = 'Fugas de aceite en block' where id = '20000000-0000-0000-0000-000000000002';
select pruebas.igual((select tipo_pedido || ' ' || horometro || ' ' || componente from v_backlog
  where id = '20000000-0000-0000-0000-000000000002'), 'Urgente 12450.5 Block de implementos', 'campos del formato en v_backlog');

-- Mejoras (014): Otro con texto, reportado y aprobado, capacidad del capturador, SAP, plazos Dimelco.
select pruebas.igual((select string_agg(valor::text, ',' order by clave) from parametros where clave like 'plazo_p%'), '1,3,14,40', 'plazos Dimelco');
select pruebas.igual((select count(*)::int from especialidades where nombre = 'Electromecánico'), 1, 'Electromecánico');
select pruebas.igual((select usa_sap from v_backlog where id = '20000000-0000-0000-0000-000000000002'), true, 'HEMCO usa SAP');
select pruebas.igual((select count(*)::int from unidades where usa_sap), 1, 'solo una unidad con SAP');
select pruebas.igual((select flota from v_backlog where id = '20000000-0000-0000-0000-000000000002'), 'Scooptram', 'familia como flota');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c"}', false);
select pruebas.espera_error($$insert into backlogs (equipo_id, sistema_id, descripcion, origen, prioridad, reportado_por)
  values ('10000000-0000-0000-0000-000000000001', (select id from sistemas where nombre = 'Motor diésel'), 'Sin aprobador', 'PM', 'P3', 'A')$$, 'quién la aprueba');
select pruebas.espera_error($$insert into backlogs (equipo_id, sistema_id, descripcion, origen, prioridad, reportado_por, aprobado_por)
  values ('10000000-0000-0000-0000-000000000001', (select id from sistemas where nombre = 'Otro'), 'Otro sin texto', 'PM', 'P3', 'A', 'B')$$, 'cuál es el sistema');
insert into backlogs (id, equipo_id, sistema_id, sistema_otro, descripcion, origen, prioridad, reportado_por, aprobado_por)
values ('20000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000001', (select id from sistemas where nombre = 'Otro'),
        'Sistema de supresión de incendios', 'Revisar boquillas', 'Inspección', 'P1', 'A', 'B');
select pruebas.igual((select fecha_limite - fecha_deteccion from backlogs where id = '20000000-0000-0000-0000-000000000009'), 1, 'P1 Urgente = 24 horas');
insert into capacidad_taller (unidad_id, especialidad_id, hh_semana, vigente_desde)
select u.id, e.id, 60, '2026-11-01' from unidades u, especialidades e where u.sigla = 'HEM' and e.nombre = 'Electromecánico';
select pruebas.espera_error($$insert into capacidad_taller (unidad_id, especialidad_id, hh_semana)
  select u.id, e.id, 60 from unidades u, especialidades e where u.sigla = 'VTN' and e.nombre = 'Mecánico'$$, 'row-level security');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000e"}', false);
select pruebas.espera_error($$insert into capacidad_taller (unidad_id, especialidad_id, hh_semana, vigente_desde)
  select u.id, e.id, 60, '2026-10-01' from unidades u, especialidades e where u.sigla = 'HEM' and e.nombre = 'Mecánico'$$, 'row-level security');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a"}', false);
insert into familias (id, nombre) values ('50000000-0000-0000-0000-000000000001', 'PowerROC T35');
insert into familia_sistemas (familia_id, sistema_id) select '50000000-0000-0000-0000-000000000001', id from sistemas where nombre in ('Motor diésel', 'Perforadora');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c"}', false);
select pruebas.igual((select count(*)::int from familia_sistemas where familia_id = '50000000-0000-0000-0000-000000000001'), 2, 'capturador lee sistemas por familia');
select pruebas.espera_error($$insert into familias (nombre) values ('No puede')$$, 'row-level security');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a"}', false);


-- Borrar (015): capturador de la unidad, cualquier estado, con motivo; admin restaura.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c"}', false);
select pruebas.igual((select estado from v_backlog where id = '20000000-0000-0000-0000-000000000001'), 'Validado', 'BL 1 validado antes de borrar');
select pruebas.espera_error($$select borrar_backlog('20000000-0000-0000-0000-000000000002', 'no')$$, 'motivo');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000e"}', false);
select pruebas.espera_error($$select borrar_backlog('20000000-0000-0000-0000-000000000001', 'Invitado no puede')$$, 'Solo el administrador o un capturador');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000d"}', false);
select pruebas.espera_error($$select borrar_backlog('20000000-0000-0000-0000-000000000002', 'Otra unidad no puede')$$, 'Solo el administrador o un capturador');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c"}', false);
select pruebas.espera_error($$select borrar_backlog('20000000-0000-0000-0000-000000000001', 'Registrado dos veces')$$, 'solo el administrador puede borrarlo');
select borrar_backlog('20000000-0000-0000-0000-000000000002', 'Equipo equivocado');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a"}', false);
select borrar_backlog('20000000-0000-0000-0000-000000000001', 'Registrado dos veces');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c"}', false);
select pruebas.igual((select count(*)::int from v_backlog where id in ('20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002')), 0, 'borrados fuera de v_backlog');
select pruebas.igual((select hh_pendientes from v_semanas_backlog where especialidad = 'Mecánico' and unidad_id = (select id from unidades where sigla = 'HEM')), 20::numeric, 'HH pendientes sin el borrado');
select pruebas.igual((select cierres from v_backlog_semanal where semana = '2026-11-02'), 0::bigint, 'cierre borrado no cuenta');
select pruebas.igual((select motivo_borrado || ' / ' || estado from v_backlog_borrados where id = '20000000-0000-0000-0000-000000000001'), 'Registrado dos veces / Validado', 'lista de borrados');
select pruebas.espera_error($$select borrar_backlog('20000000-0000-0000-0000-000000000002', 'Otra vez')$$, 'ya está borrado');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a"}', false);
select pruebas.espera_error($$update backlogs set descripcion = 'cambio a un borrado' where id = '20000000-0000-0000-0000-000000000002'$$, 'está borrado');
select pruebas.espera_error($$insert into backlog_hh (backlog_id, especialidad_id, tipo, personas, horas)
  select '20000000-0000-0000-0000-000000000002', id, 'estimada', 1, 1 from especialidades where nombre = 'Soldador'$$, 'está borrado');
select pruebas.espera_error($$select cambiar_estado_backlog('20000000-0000-0000-0000-000000000002', 'Anulado', '{"motivo":"x"}')$$, 'está borrado');
select pruebas.espera_error($$update backlogs set borrado_en = null where id = '20000000-0000-0000-0000-000000000002'$$, 'está borrado');
select pruebas.espera_error($$update backlogs set borrado_en = now() where id = '20000000-0000-0000-0000-000000000003'$$, 'borrar_backlog');
update parametros set valor = 20 where clave = 'plazo_p3_dias';
select recalcular_fechas_limite();
update parametros set valor = 14 where clave = 'plazo_p3_dias';
select recalcular_fechas_limite();
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c"}', false);
select pruebas.espera_error($$select restaurar_backlog('20000000-0000-0000-0000-000000000002')$$, 'Solo el administrador');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a"}', false);
select restaurar_backlog('20000000-0000-0000-0000-000000000002');
select pruebas.igual((select descripcion from v_backlog where id = '20000000-0000-0000-0000-000000000002'), 'Cambio de alternador', 'restaurado vuelve a v_backlog');
select pruebas.igual((select string_agg(tipo, ',' order by creado_en, id) from backlog_eventos
  where backlog_id = '20000000-0000-0000-0000-000000000002' and tipo in ('borrado','restaurado')), 'borrado,restaurado', 'bitácora de borrado y restauración');
insert into backlogs (id, equipo_id, sistema_id, descripcion, origen, prioridad, reportado_por, aprobado_por)
values ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001', (select id from sistemas where nombre = 'Motor diésel'), 'Después de borrar', 'PM', 'P3', 'A', 'B');
select pruebas.igual((select folio from backlogs where id = '20000000-0000-0000-0000-00000000000a'), 'BL-HEM-000006', 'folio no se reutiliza');


-- Sistemas por familia (016): catálogo único y familias de la biblioteca.
select pruebas.igual((select count(*)::int from familias where nombre in ('Scooptram ST1030','Boomer S1D','Furukawa HCR','PowerROC D55')), 4, 'familias de la biblioteca');
select pruebas.igual((select string_agg(s.nombre, ',' order by s.orden) from familia_sistemas r join familias f on f.id = r.familia_id join sistemas s on s.id = r.sistema_id
  where f.nombre = 'Ground Force AT18E'), 'Motor diésel,Sistema de enfriamiento,Tren de potencia,Frenos,Dirección,Sistema hidráulico,Sistema eléctrico,Cabina y entorno del operador,Bastidor y chasis,Caja de carga', 'sistemas del AT18E');
select pruebas.igual((select count(*)::int from sistemas where nombre in ('Motor','Transmisión','Neumáticos','Empernadora')), 0, 'nombres viejos renombrados');


-- Varias unidades (017): capturador HEMCO + Veta Nueva.
reset role;
update perfiles set unidades = array[(select id from unidades where sigla = 'HEM'), (select id from unidades where sigla = 'VTN')]
 where correo = 'cap.hem@prueba';
select pruebas.igual((select unidad_id = (select id from unidades where sigla = 'HEM') from perfiles where correo = 'cap.hem@prueba'), true, 'unidad_id es la primera');
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c"}', false);
select pruebas.igual((select count(distinct unidad_id)::int from equipos), 2, 've equipos de HEMCO y Veta Nueva');
insert into backlogs (id, equipo_id, sistema_id, descripcion, origen, prioridad, reportado_por, aprobado_por)
values ('20000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-000000000002', (select id from sistemas where nombre = 'Frenos'), 'Registro en Veta Nueva', 'PM', 'P3', 'A', 'B');
select pruebas.igual((select folio like 'BL-VTN-%' from v_backlog where id = '20000000-0000-0000-0000-00000000000b'), true, 'registra y ve en su segunda unidad');
reset role;
update perfiles set unidades = array[(select id from unidades where sigla = 'HEM')] where correo = 'cap.hem@prueba';
set role authenticated;
select pruebas.igual((select count(*)::int from v_backlog where id = '20000000-0000-0000-0000-00000000000b'), 0, 'al quitar Veta Nueva deja de verla');
reset role;
select pruebas.espera_error($$update perfiles set unidades = '{}' where correo = 'cap.hem@prueba'$$, 'perfiles_unidad_requerida');
update perfiles set unidad_id = (select id from unidades where sigla = 'EXP') where correo = 'inv.hem@prueba';
select pruebas.igual((select unidades = array[(select id from unidades where sigla = 'EXP')] from perfiles where correo = 'inv.hem@prueba'), true, 'cambiar unidad_id reemplaza la lista');
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a"}', false);


-- Capturador autónomo (018): hace el ciclo completo, retrocede con motivo y valida;
-- el backlog validado queda bloqueado para él.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c"}', false);
insert into backlogs (id, equipo_id, sistema_id, descripcion, origen, prioridad, reportado_por, aprobado_por)
values ('20000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-000000000001', (select id from sistemas where nombre = 'Frenos'), 'Cambio de pastillas', 'PM', 'P3', 'A', 'B');
insert into backlog_hh (backlog_id, especialidad_id, tipo, personas, horas)
values ('20000000-0000-0000-0000-0000000000c1', (select id from especialidades where nombre = 'Mecánico'), 'estimada', 1, 3);
update backlogs set descripcion = 'Cambio de pastillas de freno' where id = '20000000-0000-0000-0000-0000000000c1';
select cambiar_estado_backlog('20000000-0000-0000-0000-0000000000c1', 'En planificación', '{"prioridad":"P2"}');
update backlogs set descripcion = 'Cambio de pastillas de freno delanteras' where id = '20000000-0000-0000-0000-0000000000c1';
select pruebas.igual((select descripcion from backlogs where id = '20000000-0000-0000-0000-0000000000c1'), 'Cambio de pastillas de freno delanteras', 'capturador edita en planificación');
select pruebas.espera_error($$select cambiar_estado_backlog('20000000-0000-0000-0000-0000000000c1', 'Identificado')$$, 'motivo');
select cambiar_estado_backlog('20000000-0000-0000-0000-0000000000c1', 'Identificado', '{"motivo":"Falta confirmar el diagnóstico"}');
select pruebas.igual((select texto from backlog_eventos where backlog_id = '20000000-0000-0000-0000-0000000000c1' order by creado_en desc, id desc limit 1),
  'Retroceso · Falta confirmar el diagnóstico', 'retroceso en la bitácora');
select cambiar_estado_backlog('20000000-0000-0000-0000-0000000000c1', 'En planificación');
select cambiar_estado_backlog('20000000-0000-0000-0000-0000000000c1', 'Listo para programar');
select cambiar_estado_backlog('20000000-0000-0000-0000-0000000000c1', 'Programado', '{"fecha_programada":"2026-11-05","ot_sap":"777"}');
select cambiar_estado_backlog('20000000-0000-0000-0000-0000000000c1', 'Programado', '{"fecha_programada":"2026-11-06","motivo":"Sin parada el jueves"}');
select cambiar_estado_backlog('20000000-0000-0000-0000-0000000000c1', 'Listo para programar', '{"motivo":"Cambio de prioridades de producción"}');
select cambiar_estado_backlog('20000000-0000-0000-0000-0000000000c1', 'Programado', '{"fecha_programada":"2026-11-06"}');
insert into backlog_hh (backlog_id, especialidad_id, tipo, personas, horas)
values ('20000000-0000-0000-0000-0000000000c1', (select id from especialidades where nombre = 'Mecánico'), 'real', 1, 2);
select cambiar_estado_backlog('20000000-0000-0000-0000-0000000000c1', 'Ejecutado', '{"fecha_ejecucion":"2026-11-02"}');
select cambiar_estado_backlog('20000000-0000-0000-0000-0000000000c1', 'Programado', '{"motivo":"Quedó una fuga, se repite"}');
select pruebas.igual((select fecha_ejecucion is null and ot_sap = '777' from backlogs where id = '20000000-0000-0000-0000-0000000000c1'), true, 'volver a programado borra la ejecución y deja la OT');
select cambiar_estado_backlog('20000000-0000-0000-0000-0000000000c1', 'Ejecutado', '{"fecha_ejecucion":"2026-11-02"}');
select cambiar_estado_backlog('20000000-0000-0000-0000-0000000000c1', 'Validado');
update backlogs set descripcion = 'Cambio después de validar' where id = '20000000-0000-0000-0000-0000000000c1';
select pruebas.igual((select descripcion from backlogs where id = '20000000-0000-0000-0000-0000000000c1'), 'Cambio de pastillas de freno delanteras', 'validado no se edita');
select pruebas.espera_error($$select cambiar_estado_backlog('20000000-0000-0000-0000-0000000000c1', 'Ejecutado', '{"motivo":"Revisar"}')$$, 'solo el administrador puede revertirlo');
select pruebas.espera_error($$select borrar_backlog('20000000-0000-0000-0000-0000000000c1', 'Prueba de borrado')$$, 'solo el administrador puede borrarlo');
-- Rechazar y anular: el capturador sí; reabrir, solo el admin.
insert into backlogs (id, equipo_id, sistema_id, descripcion, origen, prioridad, reportado_por, aprobado_por)
values ('20000000-0000-0000-0000-0000000000c2', '10000000-0000-0000-0000-000000000001', (select id from sistemas where nombre = 'Frenos'), 'Revisar ruido en freno', 'Operador', 'P4', 'A', 'B');
select cambiar_estado_backlog('20000000-0000-0000-0000-0000000000c2', 'Rechazado', '{"motivo":"No procede: ruido normal"}');
select pruebas.espera_error($$select cambiar_estado_backlog('20000000-0000-0000-0000-0000000000c2', 'Identificado', '{"motivo":"Reabrir"}')$$, 'solo el administrador puede revertirlo');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a"}', false);
select cambiar_estado_backlog('20000000-0000-0000-0000-0000000000c2', 'Identificado', '{"motivo":"El ruido volvió"}');
select pruebas.igual((select estado || ' ' || coalesce(motivo_anulacion, '-') from backlogs where id = '20000000-0000-0000-0000-0000000000c2'), 'Identificado -', 'admin reabre');
select cambiar_estado_backlog('20000000-0000-0000-0000-0000000000c1', 'Ejecutado', '{"motivo":"Falta adjuntar la prueba"}');
select pruebas.igual((select estado from backlogs where id = '20000000-0000-0000-0000-0000000000c1'), 'Ejecutado', 'admin revierte el validado');

reset role;
\o
select 'Bitácora del BL-HEM-000001:' as titulo;
select estado_anterior, estado_nuevo, tipo, texto from backlog_eventos
where backlog_id = '20000000-0000-0000-0000-000000000001' order by creado_en, id;
select 'PRUEBA OK' as resultado;
