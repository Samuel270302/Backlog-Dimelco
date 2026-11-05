-- Datos para la prueba de extremo a extremo (base local, después de las migraciones).
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@prueba', '{"nombre":"Ana Admin"}'),
  ('00000000-0000-0000-0000-00000000000c', 'cap@prueba', '{"nombre":"Carlos Capturador"}');
update perfiles set rol = 'admin', activo = true where correo = 'admin@prueba';
update perfiles set activo = true, unidad_id = (select id from unidades where sigla = 'HEM') where correo = 'cap@prueba';

insert into equipos (unidad_id, cod_interno, cod_sap, modelo, flota, marca)
select u.id, v.cod, v.sap, v.modelo, v.flota, 'Epiroc'
from unidades u,
     (values ('PS011', '10002345', 'ST1030', 'Scoop'),
             ('PS012', '10002346', 'ST1030', 'Scoop'),
             ('JU005', '10002399', 'Boomer S1D', 'Jumbo')) v(cod, sap, modelo, flota)
where u.sigla = 'HEM';
insert into equipos (unidad_id, cod_interno, modelo, flota, marca)
select id, 'PS090', 'ST7', 'Scoop', 'Epiroc' from unidades where sigla = 'VTN';
