-- Datos para las capturas del manual del capturador: unidad Explotec (sin SAP) con
-- equipos de la biblioteca (Equipos de perforacion > MANUALES EXPLOTEC) y las
-- familias reales de la migración 016. Uso: SEMILLA=semilla_manual.sql tests/e2e.sh manual_capturador.mjs
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@prueba', '{"nombre":"Samuel Zapata"}'),
  ('00000000-0000-0000-0000-00000000000f', 'planeador.explotec@grupodimelco.com', '{"nombre":"Planeador Explotec"}');
update perfiles set rol = 'admin', activo = true where correo = 'admin@prueba';
update perfiles set activo = true, unidad_id = (select id from unidades where sigla = 'EXP')
 where correo = 'planeador.explotec@grupodimelco.com';

insert into equipos (unidad_id, cod_interno, modelo, marca, familia_id, flota)
select u.id, v.cod, v.modelo, v.marca, f.id, f.nombre
from unidades u,
     (values ('B1-20', 'SmartROC T40', 'Epiroc', 'SmartROC T40'),
             ('B1-31', 'PowerROC T50', 'Epiroc', 'PowerROC T50'),
             ('TD22008LC', 'PowerROC T35', 'Epiroc', 'PowerROC T25 / T30 / T35'),
             ('B1-27', 'XQZ152', 'XCMG', 'XCMG XQZ152'),
             ('B1-28', 'XQZ152', 'XCMG', 'XCMG XQZ152')) v(cod, modelo, marca, familia)
join familias f on f.nombre = v.familia
where u.sigla = 'EXP';

-- Backlogs de contexto (los mueve el admin con la función real).
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a"}', false);
insert into backlogs (id, equipo_id, sistema_id, descripcion, origen, prioridad, tipo_pedido, componente, fecha_deteccion, reportado_por, aprobado_por, justificacion)
select v.id::uuid, e.id, s.id, v.descr, v.origen, v.pri, v.tipo, v.comp, current_date - v.dias, 'Operador turno A', 'Supervisor de mina', v.just
from (values
  ('60000000-0000-0000-0000-000000000001', 'B1-20', 'Colector de polvo', 'Cambio de mangueras del colector de polvo por desgaste', 'Inspección', 'P3', 'Normal', 'Mangueras del colector', 20, 'Mangueras con cortes; el polvo sale a la cabina'),
  ('60000000-0000-0000-0000-000000000002', 'B1-31', 'Sistema eléctrico', 'Reparar luz de trabajo del brazo', 'Operador', 'P4', 'Normal', 'Luz de trabajo del brazo', 1, null),
  ('60000000-0000-0000-0000-000000000003', 'B1-27', 'Tren de rodaje (orugas)', 'Cambio de rodillos inferiores de la oruga izquierda', 'PM', 'P3', 'Normal', 'Rodillos de oruga', 6, null),
  ('60000000-0000-0000-0000-000000000004', 'B1-28', 'Compresor', 'Revisar temperatura alta del compresor', 'Falla', 'P2', 'Urgente', 'Enfriador del compresor', 2, null)
) v(id, equipo, sistema, descr, origen, pri, tipo, comp, dias, just)
join equipos e on e.cod_interno = v.equipo
join sistemas s on s.nombre = v.sistema
order by v.id;

insert into backlog_hh (backlog_id, especialidad_id, tipo, personas, horas)
select v.b::uuid, e.id, 'estimada', v.p, v.h
from (values ('60000000-0000-0000-0000-000000000001', 'Mecánico', 2, 3),
             ('60000000-0000-0000-0000-000000000002', 'Eléctrico', 1, 2),
             ('60000000-0000-0000-0000-000000000003', 'Mecánico', 2, 4),
             ('60000000-0000-0000-0000-000000000004', 'Mecánico', 1, 4),
             ('60000000-0000-0000-0000-000000000004', 'Electromecánico', 1, 2)) v(b, n, p, h)
join especialidades e on e.nombre = v.n;

select cambiar_estado_backlog('60000000-0000-0000-0000-000000000003', 'En planificación');
select cambiar_estado_backlog('60000000-0000-0000-0000-000000000003', 'Listo para programar');
select cambiar_estado_backlog('60000000-0000-0000-0000-000000000003', 'Programado',
  jsonb_build_object('fecha_programada', current_date + 1, 'ot_sap', 'OT-EXP-0412'));
select cambiar_estado_backlog('60000000-0000-0000-0000-000000000004', 'En planificación');
select set_config('request.jwt.claims', '', false);

-- Capacidad de Explotec (Mecánico la carga el capturador en la pantalla).
insert into capacidad_taller (unidad_id, especialidad_id, hh_semana, vigente_desde)
select u.id, e.id, v.hh, current_date - 30
from unidades u, (values ('Mecánico', 40), ('Eléctrico', 20), ('Electromecánico', 20)) v(esp, hh)
join especialidades e on e.nombre = v.esp
where u.sigla = 'EXP';
