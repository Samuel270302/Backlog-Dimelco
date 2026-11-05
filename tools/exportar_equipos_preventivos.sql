-- Copia de equipos de preventivos a backlog, sin Python.
-- 1. Ejecutar esta consulta en el SQL Editor del proyecto de PREVENTIVOS (solo lee).
-- 2. Copiar el texto de la única celda del resultado.
-- 3. Pegarlo y ejecutarlo en el SQL Editor del proyecto de BACKLOG.
-- Si un equipo ya existe en backlog, se actualizan cod_sap, modelo y activo.
select string_agg(
  format('insert into equipos (unidad_id, cod_interno, cod_sap, modelo, flota, activo) '
         'select id, %L, %L, %L, %L, %L::boolean from unidades where nombre = %L '
         'on conflict (unidad_id, cod_interno) do update set cod_sap = excluded.cod_sap, '
         'modelo = excluded.modelo, activo = excluded.activo;',
         e.cod_interno, e.cod_sap, e.modelo, nullif(trim(split_part(e.cod_interno, '#', 1)), ''),
         e.activo, u.nombre),
  E'\n' order by u.orden, e.cod_interno) as sql_para_backlog
from equipos e
join unidades u on u.id = e.unidad_id;
