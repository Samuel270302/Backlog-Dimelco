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
insert into backlogs (id, equipo_id, sistema_id, descripcion, origen, prioridad, fecha_deteccion, reportado_por)
values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
        (select id from sistemas where nombre = 'Sistema hidráulico'),
        'Fuga en cilindro de levante lado izquierdo', 'Inspección', 'P2', '2026-10-30', 'J. Pérez');
select pruebas.igual((select folio from backlogs where id = '20000000-0000-0000-0000-000000000001'), 'BL-HEM-000001', 'folio');
select pruebas.igual((select fecha_limite from backlogs where id = '20000000-0000-0000-0000-000000000001'), date '2026-11-06', 'fecha límite P2');
select pruebas.igual((select count(*) from backlog_eventos)::int, 1, 'evento de registro');
insert into backlog_hh (backlog_id, especialidad_id, tipo, personas, horas)
values ('20000000-0000-0000-0000-000000000001', (select id from especialidades where nombre = 'Mecánico'), 'estimada', 2, 4);
update backlogs set descripcion = 'Fuga en cilindro de levante izquierdo, sello dañado' where id = '20000000-0000-0000-0000-000000000001';
select pruebas.espera_error($$update backlogs set estado = 'Programado' where id = '20000000-0000-0000-0000-000000000001'$$, 'cambiar_estado_backlog');
select pruebas.espera_error($$select cambiar_estado_backlog('20000000-0000-0000-0000-000000000001', 'En planificación')$$, 'Solo el administrador');
select pruebas.espera_error($$insert into backlogs (equipo_id, sistema_id, descripcion, origen, prioridad)
  values ('10000000-0000-0000-0000-000000000002', (select id from sistemas limit 1), 'Equipo de otra unidad', 'PM', 'P3')$$, 'row-level security');
select pruebas.espera_error($$insert into backlogs (equipo_id, sistema_id, descripcion, origen, prioridad, fecha_deteccion)
  values ('10000000-0000-0000-0000-000000000001', (select id from sistemas limit 1), 'Detección futura', 'PM', 'P3', '2026-12-01')$$, 'futura');

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
select pruebas.igual((select fecha_limite from backlogs where id = '20000000-0000-0000-0000-000000000001'), date '2026-11-01', 'límite recalculado a P1');
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
select pruebas.espera_error($$select cambiar_estado_backlog('20000000-0000-0000-0000-000000000001', 'Programado', '{"fecha_programada":"2026-11-04"}')$$, 'OT SAP');
select pruebas.espera_error($$select cambiar_estado_backlog('20000000-0000-0000-0000-000000000001', 'Programado', '{"fecha_programada":"2026-10-28","ot_sap":"4001"}')$$, 'pasada');
select cambiar_estado_backlog('20000000-0000-0000-0000-000000000001', 'Programado', '{"fecha_programada":"2026-11-04","ot_sap":"4001234"}');
select pruebas.igual((select semana_programada from backlogs where id = '20000000-0000-0000-0000-000000000001'), date '2026-11-02', 'semana lunes');
select pruebas.igual((select hh_programadas from v_carga_semanal)::numeric, 8::numeric, 'carga semanal');
select pruebas.espera_error($$select cambiar_estado_backlog('20000000-0000-0000-0000-000000000001', 'Listo para programar')$$, 'motivo');
select cambiar_estado_backlog('20000000-0000-0000-0000-000000000001', 'Listo para programar', '{"motivo":"Equipo en producción, sin parada"}');
select pruebas.igual((select reprogramaciones from backlogs where id = '20000000-0000-0000-0000-000000000001'), 1, 'reprogramaciones');
select cambiar_estado_backlog('20000000-0000-0000-0000-000000000001', 'Programado', '{"fecha_programada":"2026-11-10","ot_sap":"4001234","aprovechar_pm":true}');

-- Capturador ejecuta con HH reales; admin cierra.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c"}', false);
select pruebas.espera_error($$select cambiar_estado_backlog('20000000-0000-0000-0000-000000000001', 'Ejecutado', '{"fecha_ejecucion":"2026-11-02"}')$$, 'HH reales');
insert into backlog_hh (backlog_id, especialidad_id, tipo, personas, horas)
values ('20000000-0000-0000-0000-000000000001', (select id from especialidades where nombre = 'Mecánico'), 'real', 2, 5);
select pruebas.espera_error($$select cambiar_estado_backlog('20000000-0000-0000-0000-000000000001', 'Ejecutado', '{"fecha_ejecucion":"2026-11-20"}')$$, 'futura');
select cambiar_estado_backlog('20000000-0000-0000-0000-000000000001', 'Ejecutado', '{"fecha_ejecucion":"2026-11-02","comentario":"Se cambiaron sellos"}');
select pruebas.espera_error($$select cambiar_estado_backlog('20000000-0000-0000-0000-000000000001', 'Cerrado')$$, 'Solo el administrador');
insert into backlog_eventos (backlog_id, tipo, texto) values ('20000000-0000-0000-0000-000000000001', 'comentario', 'Equipo probado OK');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a"}', false);
select cambiar_estado_backlog('20000000-0000-0000-0000-000000000001', 'Cerrado');
select pruebas.espera_error($$update backlogs set descripcion = 'cambio tardío' where id = '20000000-0000-0000-0000-000000000001'$$, 'no se edita');
select pruebas.espera_error($$delete from backlog_hh where backlog_id = '20000000-0000-0000-0000-000000000001'$$, 'no se edita');
select pruebas.igual((select hh_reales from v_backlog where id = '20000000-0000-0000-0000-000000000001'), 10::numeric, 'HH reales');
select pruebas.igual((select antiguedad_dias from v_backlog where id = '20000000-0000-0000-0000-000000000001'), 3, 'antigüedad al ejecutar');
select pruebas.igual((select cierres from v_backlog_semanal where semana = '2026-11-02'), 1::bigint, 'cierre semanal');

-- Semanas de backlog: 3 backlogs abiertos de HEMCO con 30 + 20 + 50 HH mecánicas = 100 HH / 100 HH semana.
insert into backlogs (id, equipo_id, sistema_id, descripcion, origen, prioridad) values
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', (select id from sistemas where nombre = 'Motor'), 'Cambio de alternador', 'Falla', 'P3'),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', (select id from sistemas where nombre = 'Frenos'), 'Regular frenos de servicio', 'PM', 'P4'),
  ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', (select id from sistemas where nombre = 'Neumáticos'), 'Rotación de llantas', 'Operador', 'P4');
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

reset role;
\o
select 'Bitácora del BL-HEM-000001:' as titulo;
select estado_anterior, estado_nuevo, tipo, texto from backlog_eventos
where backlog_id = '20000000-0000-0000-0000-000000000001' order by creado_en, id;
select 'PRUEBA OK' as resultado;
