-- Copia de usuarios de preventivos a backlog, con la misma contraseña.
-- 1. Ejecutar esta consulta en el SQL Editor del proyecto de PREVENTIVOS (solo lee).
-- 2. Copiar el texto de la única celda del resultado (trae las contraseñas cifradas:
--    pegarlo solo en el SQL Editor de backlog y no compartirlo).
-- 3. Pegarlo y ejecutarlo en el SQL Editor del proyecto de BACKLOG. Se puede repetir:
--    los usuarios que ya existen se saltan y el perfil se vuelve a ajustar.
-- Copia cuentas de acceso (auth.users y auth.identities) y deja en perfiles el nombre,
-- el rol, si está activo y la unidad (por nombre) que tiene cada uno en preventivos.
with
cu as (
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) as c
  from information_schema.columns
  where table_schema = 'auth' and table_name = 'users' and is_generated = 'NEVER'
),
ci as (
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) as c
  from information_schema.columns
  where table_schema = 'auth' and table_name = 'identities' and is_generated = 'NEVER'
)
select concat_ws(E'\n',
  '-- Usuarios de preventivos (' || (select count(*) from auth.users) || ')',
  (select string_agg(
     format('insert into auth.users (%1$s) select %1$s from jsonb_populate_record(null::auth.users, %2$L::jsonb) on conflict do nothing;',
            cu.c, to_jsonb(u)),
     E'\n' order by u.created_at)
   from auth.users u, cu),
  (select string_agg(
     format('insert into auth.identities (%1$s) select %1$s from jsonb_populate_record(null::auth.identities, %2$L::jsonb) on conflict do nothing;',
            ci.c, to_jsonb(i)),
     E'\n' order by i.created_at)
   from auth.identities i, ci),
  (select string_agg(
     format('update perfiles set nombre = %L, rol = %L, activo = %L::boolean, unidad_id = (select id from unidades where nombre = %L) where user_id = %L;',
            p.nombre, p.rol, p.activo, un.nombre, p.user_id),
     E'\n' order by p.nombre)
   from perfiles p left join unidades un on un.id = p.unidad_id),
  'select p.nombre, p.correo, p.rol, p.activo, u.nombre as unidad from perfiles p left join unidades u on u.id = p.unidad_id order by p.rol, p.nombre;'
) as sql_para_backlog;
