-- Sistemas por familia de equipo, tomados de los listados de sistemas de la biblioteca
-- (BIblioteca > Equipos de perforacion > Listados de sistemas, 06/11/2026): capítulos de
-- los manuales de mantenimiento cruzados con los grupos de los catálogos de partes.
-- Un solo catálogo de sistemas con el mismo nombre en todas las familias, para que los
-- indicadores se puedan comparar entre equipos. Se puede repetir; no borra lo que el
-- administrador agregue después en Familias y sistemas.

-- 1. Nombres: los sistemas iniciales toman el nombre del catálogo nuevo (mismo id, así
--    los backlogs que ya los usan no cambian).
do $$
declare
  r record;
begin
  for r in select * from (values
    ('Motor', 'Motor diésel'),
    ('Transmisión', 'Tren de potencia'),
    ('Estructura y chasis', 'Bastidor y chasis'),
    ('Neumáticos', 'Ruedas y neumáticos'),
    ('Empernadora', 'Unidad de empernado'),
    ('Cabina y seguridad', 'Cabina y entorno del operador')
  ) v(antes, despues) loop
    update sistemas set nombre = r.despues
     where nombre = r.antes and not exists (select 1 from sistemas where nombre = r.despues);
    -- Al repetir la instalación, 002 vuelve a crear el nombre viejo: si nadie lo usa se
    -- borra; si algún backlog lo usa, se desactiva.
    delete from sistemas s
     where s.nombre = r.antes
       and not exists (select 1 from backlogs b where b.sistema_id = s.id)
       and not exists (select 1 from familia_sistemas fs where fs.sistema_id = s.id);
    update sistemas set activo = false where nombre = r.antes;
  end loop;
end $$;

insert into sistemas (nombre, orden) values
  ('Motor diésel', 1),
  ('Sistema de enfriamiento', 2),
  ('Admisión y escape', 3),
  ('Tren de potencia', 4),
  ('Frenos', 5),
  ('Dirección', 6),
  ('Sistema hidráulico', 7),
  ('Sistema eléctrico', 8),
  ('Control y electrónica', 9),
  ('Neumático y agua', 10),
  ('Compresor', 11),
  ('Neblina de agua', 12),
  ('Lubricación', 13),
  ('Extinción de incendios', 14),
  ('Cabina y entorno del operador', 15),
  ('Bastidor y chasis', 16),
  ('Ruedas y neumáticos', 17),
  ('Tren de rodaje (orugas)', 18),
  ('Brazo (boom)', 19),
  ('Cuchara', 20),
  ('Caja de carga', 21),
  ('Unidad de avance', 22),
  ('Perforadora', 23),
  ('Unidad de rotación', 24),
  ('Manejo de barras', 25),
  ('Colector de polvo', 26),
  ('Tambor de cable y manguera', 27),
  ('Unidad de empernado', 28),
  ('Manejo de malla', 29),
  ('Sistema de resina', 30),
  ('Bomba Swellex', 31),
  ('Cabrestante', 32),
  ('Cuba mezcladora', 33),
  ('Bomba de concreto', 34),
  ('Bomba dosificadora de aditivo', 35),
  ('Martillo de desatado', 36),
  ('Otro', 99)
on conflict (nombre) do update set orden = excluded.orden, activo = true;

-- 2. Familias, el patrón del modelo de sus equipos y sus sistemas.
drop table if exists pg_temp._familias;
create temporary table _familias (
  nombre   text primary key,
  orden    integer,
  patron   text,      -- expresión regular sobre equipos.modelo (sin distinguir mayúsculas)
  sistemas text[]
);

insert into _familias values
  ('Scooptram ST1030', 1, 'ST\s*1030',
   array['Motor diésel','Sistema de enfriamiento','Admisión y escape','Tren de potencia','Frenos','Dirección','Sistema hidráulico','Sistema eléctrico','Control y electrónica','Lubricación','Extinción de incendios','Cabina y entorno del operador','Bastidor y chasis','Ruedas y neumáticos','Brazo (boom)','Cuchara']),
  ('Scooptram ST3.5', 2, 'ST\s*3[.,]5',
   array['Motor diésel','Sistema de enfriamiento','Admisión y escape','Tren de potencia','Frenos','Dirección','Sistema hidráulico','Sistema eléctrico','Lubricación','Extinción de incendios','Cabina y entorno del operador','Bastidor y chasis','Ruedas y neumáticos','Brazo (boom)','Cuchara']),
  ('Caterpillar R1600H', 3, 'R\s*1600',
   array['Motor diésel','Sistema de enfriamiento','Admisión y escape','Tren de potencia','Frenos','Dirección','Sistema hidráulico','Sistema eléctrico','Control y electrónica','Cabina y entorno del operador','Bastidor y chasis','Cuchara']),
  ('Ground Force AT18E', 4, 'AT\s*18|UG\s*18',
   array['Motor diésel','Sistema de enfriamiento','Tren de potencia','Frenos','Dirección','Sistema hidráulico','Sistema eléctrico','Cabina y entorno del operador','Bastidor y chasis','Caja de carga']),
  ('Boomer S1D', 5, 'S1\s*D',
   array['Motor diésel','Sistema de enfriamiento','Admisión y escape','Tren de potencia','Frenos','Dirección','Sistema hidráulico','Sistema eléctrico','Control y electrónica','Neumático y agua','Compresor','Neblina de agua','Lubricación','Extinción de incendios','Cabina y entorno del operador','Bastidor y chasis','Ruedas y neumáticos','Brazo (boom)','Unidad de avance','Perforadora','Manejo de barras','Tambor de cable y manguera']),
  ('Boomer 282', 6, 'Boomer\s*282|^\s*282\s*$',
   array['Motor diésel','Admisión y escape','Tren de potencia','Frenos','Dirección','Sistema hidráulico','Sistema eléctrico','Control y electrónica','Neumático y agua','Compresor','Neblina de agua','Lubricación','Extinción de incendios','Cabina y entorno del operador','Bastidor y chasis','Ruedas y neumáticos','Brazo (boom)','Unidad de avance','Perforadora','Unidad de rotación','Tambor de cable y manguera']),
  ('Simba S7D', 7, 'S7\s*D|Simba',
   array['Motor diésel','Sistema de enfriamiento','Admisión y escape','Tren de potencia','Frenos','Dirección','Sistema hidráulico','Sistema eléctrico','Control y electrónica','Neumático y agua','Compresor','Neblina de agua','Lubricación','Extinción de incendios','Cabina y entorno del operador','Bastidor y chasis','Ruedas y neumáticos','Brazo (boom)','Unidad de avance','Perforadora','Manejo de barras','Tambor de cable y manguera']),
  ('Boltec S', 8, 'Boltec',
   array['Motor diésel','Sistema de enfriamiento','Admisión y escape','Tren de potencia','Frenos','Dirección','Sistema hidráulico','Sistema eléctrico','Control y electrónica','Neumático y agua','Compresor','Neblina de agua','Lubricación','Extinción de incendios','Cabina y entorno del operador','Bastidor y chasis','Ruedas y neumáticos','Brazo (boom)','Perforadora','Unidad de empernado','Manejo de malla','Sistema de resina','Bomba Swellex','Tambor de cable y manguera']),
  ('Resemin Bolter', 9, 'Bolter|77\s*D',
   array['Motor diésel','Tren de potencia','Frenos','Dirección','Sistema hidráulico','Sistema eléctrico','Control y electrónica','Neumático y agua','Compresor','Lubricación','Extinción de incendios','Bastidor y chasis','Ruedas y neumáticos','Brazo (boom)','Unidad de avance','Perforadora','Unidad de rotación','Unidad de empernado','Manejo de malla','Tambor de cable y manguera']),
  ('Resemin Raptor 44XP', 10, 'Raptor|44\s*XP',
   array['Motor diésel','Tren de potencia','Sistema hidráulico','Sistema eléctrico','Neumático y agua','Compresor','Lubricación','Bastidor y chasis','Brazo (boom)','Unidad de avance','Perforadora','Unidad de rotación']),
  ('Resemin Troidon 55XP', 11, 'Troidon|55\s*XP',
   array['Motor diésel','Tren de potencia','Dirección','Sistema hidráulico','Sistema eléctrico','Neumático y agua','Compresor','Lubricación','Extinción de incendios','Bastidor y chasis','Brazo (boom)','Unidad de avance','Perforadora']),
  ('Resemin Scalemin HT', 12, 'Scalemin',
   array['Motor diésel','Tren de potencia','Sistema hidráulico','Sistema eléctrico','Neumático y agua','Lubricación','Cabina y entorno del operador','Bastidor y chasis','Brazo (boom)','Tambor de cable y manguera','Martillo de desatado']),
  ('SmartROC T40', 13, 'SmartROC|T\s*40',
   array['Motor diésel','Sistema de enfriamiento','Sistema hidráulico','Sistema eléctrico','Control y electrónica','Compresor','Neblina de agua','Lubricación','Cabina y entorno del operador','Bastidor y chasis','Tren de rodaje (orugas)','Brazo (boom)','Unidad de avance','Perforadora','Manejo de barras','Colector de polvo','Cabrestante']),
  ('PowerROC T50', 14, 'T\s*50',
   array['Motor diésel','Sistema de enfriamiento','Sistema hidráulico','Sistema eléctrico','Compresor','Neblina de agua','Lubricación','Extinción de incendios','Cabina y entorno del operador','Bastidor y chasis','Tren de rodaje (orugas)','Brazo (boom)','Unidad de avance','Perforadora','Manejo de barras','Colector de polvo']),
  ('PowerROC T25 / T30 / T35', 15, 'T\s*(25|30|35)',
   array['Motor diésel','Sistema de enfriamiento','Admisión y escape','Sistema hidráulico','Sistema eléctrico','Compresor','Neblina de agua','Lubricación','Extinción de incendios','Cabina y entorno del operador','Bastidor y chasis','Tren de rodaje (orugas)','Brazo (boom)','Unidad de avance','Perforadora','Manejo de barras','Colector de polvo']),
  ('PowerROC D55', 16, 'D\s*55',
   array['Motor diésel','Sistema de enfriamiento','Sistema hidráulico','Sistema eléctrico','Compresor','Neblina de agua','Lubricación','Extinción de incendios','Cabina y entorno del operador','Bastidor y chasis','Tren de rodaje (orugas)','Brazo (boom)','Unidad de avance','Perforadora','Unidad de rotación','Manejo de barras','Colector de polvo','Cabrestante']),
  ('Furukawa HCR', 17, 'HCR|L\s*(90|100|110)|1[12]00\s*-?\s*ED',
   array['Motor diésel','Sistema hidráulico','Sistema eléctrico','Control y electrónica','Neumático y agua','Compresor','Cabina y entorno del operador','Bastidor y chasis','Tren de rodaje (orugas)','Brazo (boom)','Unidad de avance','Perforadora','Manejo de barras','Colector de polvo']),
  ('Furukawa DCR', 18, 'DCR|L\s*130',
   array['Motor diésel','Sistema hidráulico','Sistema eléctrico','Control y electrónica','Neumático y agua','Compresor','Cabina y entorno del operador','Bastidor y chasis','Tren de rodaje (orugas)','Brazo (boom)','Unidad de avance','Perforadora','Unidad de rotación','Manejo de barras','Colector de polvo']),
  ('XCMG XCZ115', 19, 'XCZ\s*115',
   array['Motor diésel','Sistema hidráulico','Sistema eléctrico','Compresor','Lubricación','Extinción de incendios','Cabina y entorno del operador','Bastidor y chasis','Tren de rodaje (orugas)','Brazo (boom)','Unidad de avance','Perforadora','Manejo de barras','Colector de polvo']),
  ('XCMG XQZ152', 20, 'XQZ\s*152',
   array['Motor diésel','Sistema hidráulico','Sistema eléctrico','Neumático y agua','Compresor','Lubricación','Cabina y entorno del operador','Bastidor y chasis','Tren de rodaje (orugas)','Brazo (boom)','Unidad de avance','Perforadora','Unidad de rotación','Manejo de barras','Colector de polvo']),
  ('Putzmeister Mixkret 4', 21, 'Mixkret',
   array['Motor diésel','Tren de potencia','Frenos','Dirección','Sistema hidráulico','Sistema eléctrico','Neumático y agua','Extinción de incendios','Cabina y entorno del operador','Bastidor y chasis','Ruedas y neumáticos','Cuba mezcladora']),
  ('Putzmeister SPM 4210', 22, 'SPM|4210',
   array['Motor diésel','Tren de potencia','Sistema hidráulico','Sistema eléctrico','Control y electrónica','Compresor','Lubricación','Bastidor y chasis','Brazo (boom)','Tambor de cable y manguera','Bomba de concreto','Bomba dosificadora de aditivo']);

-- Un sistema mal escrito en la lista de arriba detiene la migración.
do $$
declare
  v_falta text;
begin
  select string_agg(distinct s, ', ') into v_falta
  from _familias, unnest(sistemas) s
  where not exists (select 1 from sistemas where nombre = s);
  if v_falta is not null then
    raise exception 'Sistemas que no están en el catálogo: %', v_falta;
  end if;
end $$;

insert into familias (nombre, orden)
select nombre, orden from _familias
on conflict (nombre) do update set orden = excluded.orden, activo = true;

-- Relaciones: se agregan las de la lista; las que el admin marcó a mano se conservan.
insert into familia_sistemas (familia_id, sistema_id)
select f.id, s.id
from _familias t
join familias f on f.nombre = t.nombre
cross join lateral unnest(t.sistemas) n
join sistemas s on s.nombre = n
on conflict do nothing;

-- 3. Equipos: los que no tienen familia, o están en una familia creada desde la flota
--    escrita (sin sistemas marcados), pasan a la familia que corresponde a su modelo.
--    Si el modelo calza con más de una familia, no se cambia.
with candidatos as (
  select e.id as equipo_id, min(f.id::text)::uuid as familia_id, count(*) as n
  from equipos e
  join _familias t on e.modelo ~* t.patron
  join familias f on f.nombre = t.nombre
  where e.familia_id is null
     or not exists (select 1 from familia_sistemas r where r.familia_id = e.familia_id)
  group by e.id
)
update equipos e
   set familia_id = c.familia_id,
       flota = (select nombre from familias where id = c.familia_id)
  from candidatos c
 where c.equipo_id = e.id and c.n = 1;

-- Las familias que quedaron sin equipos y sin sistemas (creadas desde la flota) se
-- desactivan; no se borran.
update familias f set activo = false
 where f.activo
   and not exists (select 1 from equipos e where e.familia_id = f.id)
   and not exists (select 1 from familia_sistemas r where r.familia_id = f.id)
   and f.nombre not in (select nombre from _familias);

drop table _familias;
