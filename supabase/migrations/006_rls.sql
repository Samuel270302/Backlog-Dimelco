-- Seguridad por rol y unidad.
--   admin:      todo, en todas las unidades.
--   capturador: registra backlogs, HH, repuestos, fotos y comentarios de su unidad;
--               edita el backlog mientras está Identificado; marca Ejecutado.
--   invitado:   solo consulta su unidad.
-- Las transiciones de estado van por cambiar_estado_backlog() (004).

create or replace function unidad_de_backlog(p_backlog uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select unidad_id from backlogs where id = p_backlog
$$;

revoke execute on function rol_actual(), unidad_actual(), unidad_permitida(uuid),
  unidad_de_backlog(uuid), cambiar_estado_backlog(uuid, text, jsonb) from public;
grant execute on function rol_actual(), unidad_actual(), unidad_permitida(uuid),
  unidad_de_backlog(uuid), cambiar_estado_backlog(uuid, text, jsonb) to authenticated;

do $$
declare t text;
begin
  foreach t in array array['unidades','perfiles','parametros','equipos','sistemas','especialidades',
                           'capacidad_taller','backlogs','folios','backlog_hh','backlog_repuestos',
                           'backlog_eventos','backlog_fotos'] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- Catálogos generales: los lee cualquier usuario activo, los administra el admin.
do $$
declare t text;
begin
  foreach t in array array['unidades','parametros','sistemas','especialidades'] loop
    execute format('drop policy if exists leer_%I on %I', t, t);
    execute format('create policy leer_%I on %I for select to authenticated
                    using (rol_actual() is not null)', t, t);
    execute format('drop policy if exists administrar_%I on %I', t, t);
    execute format('create policy administrar_%I on %I for all to authenticated
                    using (rol_actual() = ''admin'') with check (rol_actual() = ''admin'')', t, t);
  end loop;
end $$;

-- Perfiles: cada uno lee el suyo aunque esté inactivo (pantalla de acceso pendiente).
drop policy if exists leer_perfiles on perfiles;
create policy leer_perfiles on perfiles for select to authenticated
  using (rol_actual() is not null or user_id = usuario_sesion());
drop policy if exists administrar_perfiles on perfiles;
create policy administrar_perfiles on perfiles for all to authenticated
  using (rol_actual() = 'admin') with check (rol_actual() = 'admin');

-- Equipos y capacidad: por unidad; los administra el admin.
do $$
declare t text;
begin
  foreach t in array array['equipos','capacidad_taller'] loop
    execute format('drop policy if exists leer_%I on %I', t, t);
    execute format('create policy leer_%I on %I for select to authenticated
                    using (rol_actual() is not null and unidad_permitida(unidad_id))', t, t);
    execute format('drop policy if exists administrar_%I on %I', t, t);
    execute format('create policy administrar_%I on %I for all to authenticated
                    using (rol_actual() = ''admin'') with check (rol_actual() = ''admin'')', t, t);
  end loop;
end $$;

-- Backlogs. Sin política de borrado: no se borran.
drop policy if exists leer_backlogs on backlogs;
create policy leer_backlogs on backlogs for select to authenticated
  using (rol_actual() is not null and unidad_permitida(unidad_id));
drop policy if exists registrar_backlogs on backlogs;
create policy registrar_backlogs on backlogs for insert to authenticated
  with check (rol_actual() in ('admin','capturador') and unidad_permitida(unidad_id));
drop policy if exists editar_backlogs on backlogs;
create policy editar_backlogs on backlogs for update to authenticated
  using (unidad_permitida(unidad_id)
         and (rol_actual() = 'admin' or (rol_actual() = 'capturador' and estado = 'Identificado')))
  with check (unidad_permitida(unidad_id));

-- Detalle del backlog: lo leen todos los de la unidad; lo editan admin y capturador.
do $$
declare t text;
begin
  foreach t in array array['backlog_hh','backlog_repuestos','backlog_fotos'] loop
    execute format('drop policy if exists leer_%I on %I', t, t);
    execute format('create policy leer_%I on %I for select to authenticated
                    using (rol_actual() is not null and unidad_permitida(unidad_de_backlog(backlog_id)))', t, t);
    execute format('drop policy if exists editar_%I on %I', t, t);
    execute format('create policy editar_%I on %I for all to authenticated
                    using (rol_actual() in (''admin'',''capturador'') and unidad_permitida(unidad_de_backlog(backlog_id)))
                    with check (rol_actual() in (''admin'',''capturador'') and unidad_permitida(unidad_de_backlog(backlog_id)))', t, t);
  end loop;
end $$;

-- Bitácora: desde la app solo se agregan comentarios propios; los eventos de estado
-- los escriben las funciones de la base.
drop policy if exists leer_backlog_eventos on backlog_eventos;
create policy leer_backlog_eventos on backlog_eventos for select to authenticated
  using (rol_actual() is not null and unidad_permitida(unidad_de_backlog(backlog_id)));
drop policy if exists comentar_backlog_eventos on backlog_eventos;
create policy comentar_backlog_eventos on backlog_eventos for insert to authenticated
  with check (rol_actual() in ('admin','capturador')
              and unidad_permitida(unidad_de_backlog(backlog_id))
              and tipo = 'comentario' and usuario = usuario_sesion()
              and estado_anterior is null and estado_nuevo is null);

-- Perfil automático (inactivo, sin unidad) al crear un usuario en Authentication.
create or replace function crear_perfil() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into perfiles (user_id, nombre, correo, rol, activo)
  values (new.id, coalesce(new.raw_user_meta_data->>'nombre', split_part(new.email, '@', 1)),
          new.email, 'capturador', false)
  on conflict (user_id) do nothing;
  return new;
end $$;

do $$
begin
  if to_regclass('auth.users') is not null then
    drop trigger if exists al_crear_usuario on auth.users;
    create trigger al_crear_usuario after insert on auth.users
      for each row execute function crear_perfil();
  end if;
end $$;

-- Tiempo real de Supabase.
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['backlogs','backlog_hh','backlog_repuestos','backlog_eventos','backlog_fotos',
                             'equipos','sistemas','especialidades','capacidad_taller','parametros','perfiles'] loop
      if not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table %I', t);
      end if;
    end loop;
  end if;
end $$;
