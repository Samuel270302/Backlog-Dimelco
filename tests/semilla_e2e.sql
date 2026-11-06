-- Datos para la prueba de extremo a extremo (base local, después de las migraciones).
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@prueba', '{"nombre":"Ana Admin"}'),
  ('00000000-0000-0000-0000-00000000000c', 'cap@prueba', '{"nombre":"Carlos Capturador"}'),
  ('00000000-0000-0000-0000-00000000000d', 'cap.vtn@prueba', '{"nombre":"Vera Veta Nueva"}');
update perfiles set rol = 'admin', activo = true where correo = 'admin@prueba';
update perfiles set activo = true, unidad_id = (select id from unidades where sigla = 'HEM') where correo = 'cap@prueba';
update perfiles set activo = true, unidad_id = (select id from unidades where sigla = 'VTN') where correo = 'cap.vtn@prueba';

insert into equipos (unidad_id, cod_interno, cod_sap, modelo, flota, marca)
select u.id, v.cod, v.sap, v.modelo, v.flota, 'Epiroc'
from unidades u,
     (values ('PS011', '10002345', 'ST1030', 'Scoop'),
             ('PS012', '10002346', 'ST1030', 'Scoop'),
             ('JU005', '10002399', 'Boomer S1D', 'Jumbo')) v(cod, sap, modelo, flota)
where u.sigla = 'HEM';
insert into equipos (unidad_id, cod_interno, modelo, flota, marca)
select id, 'PS090', 'ST7', 'Scoop', 'Epiroc' from unidades where sigla = 'VTN';

-- Familias: los Scoop de HEMCO tienen 3 sistemas cargados; el Jumbo no tiene (ve todos).
insert into familias (nombre, orden) values ('Scooptram ST1030', 1), ('Jumbo Boomer S1D', 2) on conflict (nombre) do nothing;
update equipos set familia_id = (select id from familias where nombre = 'Scooptram ST1030') where modelo = 'ST1030';
update equipos set familia_id = (select id from familias where nombre = 'Jumbo Boomer S1D') where modelo = 'Boomer S1D';
update equipos e set flota = f.nombre from familias f where f.id = e.familia_id;
delete from familia_sistemas where familia_id = (select id from familias where nombre = 'Scooptram ST1030');
insert into familia_sistemas (familia_id, sistema_id)
select f.id, s.id from familias f, sistemas s
where f.nombre = 'Scooptram ST1030' and s.nombre in ('Sistema hidráulico', 'Motor diésel', 'Frenos');

-- Backlogs de contexto en varios estados (los mueve el admin con la función real).
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a"}', false);
insert into backlogs (id, equipo_id, sistema_id, descripcion, origen, prioridad, tipo_pedido, componente, fecha_deteccion, reportado_por, aprobado_por, justificacion)
select v.id::uuid, e.id, s.id, v.descr, v.origen, v.pri, v.tipo, v.comp, current_date - v.dias, 'Supervisor turno A', 'Jefe de taller', v.just
from (values
  ('30000000-0000-0000-0000-000000000001', 'PS012', 'Sistema hidráulico', 'Cambio de mangueras de levante por desgaste', 'Inspección', 'P2', 'Urgente', 'Mangueras de levante', 3, 'Mangueras con cordones expuestos'),
  ('30000000-0000-0000-0000-000000000002', 'PS012', 'Frenos', 'Regular frenos de servicio', 'PM', 'P3', 'Normal', 'Frenos de servicio', 40, null),
  ('30000000-0000-0000-0000-000000000003', 'JU005', 'Sistema eléctrico', 'Reparar luminaria de cabina', 'Operador', 'P4', 'Normal', 'Luminaria de cabina', 1, null),
  ('30000000-0000-0000-0000-000000000004', 'JU005', 'Perforadora', 'Cambio de centralizador de barra', 'PM', 'P3', 'Normal', 'Centralizador', 6, null),
  ('30000000-0000-0000-0000-000000000005', 'PS090', 'Motor diésel', 'Fuga de refrigerante en radiador', 'Inspección', 'P2', 'Normal', 'Radiador', 2, null)
) v(id, equipo, sistema, descr, origen, pri, tipo, comp, dias, just)
join equipos e on e.cod_interno = v.equipo
join sistemas s on s.nombre = v.sistema
-- Orden fijo de los folios: BL-HEM-000001 frenos (vencido), 2 mangueras, 3 centralizador, 4 luminaria.
order by array_position(array['30000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000005'], v.id);

insert into backlog_hh (backlog_id, especialidad_id, tipo, personas, horas)
select v.b::uuid, e.id, 'estimada', v.p, v.h
from (values ('30000000-0000-0000-0000-000000000001', 'Mecánico', 2, 6),
             ('30000000-0000-0000-0000-000000000001', 'Hidráulico', 1, 6),
             ('30000000-0000-0000-0000-000000000002', 'Mecánico', 2, 3),
             ('30000000-0000-0000-0000-000000000003', 'Eléctrico', 1, 2),
             ('30000000-0000-0000-0000-000000000004', 'Mecánico', 2, 4)) v(b, n, p, h)
join especialidades e on e.nombre = v.n;
insert into backlog_repuestos (backlog_id, numero_parte, descripcion, cantidad, stock) values
  ('30000000-0000-0000-0000-000000000001', '3222337000', 'Manguera de levante 1"', 2, 0),
  ('30000000-0000-0000-0000-000000000001', '0663210201', 'Juego de o-rings', 4, 10);

select cambiar_estado_backlog('30000000-0000-0000-0000-000000000001', 'En planificación');
select cambiar_estado_backlog('30000000-0000-0000-0000-000000000004', 'En planificación');
select cambiar_estado_backlog('30000000-0000-0000-0000-000000000004', 'Listo para programar');
select cambiar_estado_backlog('30000000-0000-0000-0000-000000000004', 'Programado',
  jsonb_build_object('fecha_programada', current_date + 1, 'ot_sap', '4001190'));
select set_config('request.jwt.claims', '', false);

-- Capacidad de HEMCO (Mecánico la carga la prueba desde la pantalla).
insert into capacidad_taller (unidad_id, especialidad_id, hh_semana, vigente_desde)
select u.id, e.id, v.hh, current_date - 30
from unidades u, (values ('Eléctrico', 20), ('Hidráulico', 10)) v(esp, hh)
join especialidades e on e.nombre = v.esp
where u.sigla = 'HEM';
