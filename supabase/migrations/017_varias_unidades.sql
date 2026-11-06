-- Varias unidades por capturador o invitado. perfiles.unidades guarda todas las que
-- puede ver; unidad_id queda como la primera, para la restricción
-- perfiles_unidad_requerida y para la Edge Function admin-usuarios, que solo fija
-- unidad_id al crear (el disparador la pasa a unidades). El admin sigue viendo todas.
-- Se puede repetir.

alter table perfiles add column if not exists unidades uuid[] not null default '{}';
update perfiles set unidades = array[unidad_id] where cardinality(unidades) = 0 and unidad_id is not null;

create or replace function tg_perfil_unidades() returns trigger
language plpgsql as $$
begin
  new.unidades := coalesce(new.unidades, '{}');
  if tg_op = 'UPDATE' then
    -- Se quitaron todas las unidades: queda sin unidad (si está activo y no es admin,
    -- perfiles_unidad_requerida lo rechaza).
    if new.unidades is distinct from old.unidades and cardinality(new.unidades) = 0 then
      new.unidad_id := null;
      return new;
    end if;
    -- Cambio de unidad_id a la antigua (una sola unidad): reemplaza la lista.
    if new.unidad_id is distinct from old.unidad_id and new.unidades is not distinct from old.unidades
       and new.unidad_id is not null and not (new.unidad_id = any(new.unidades)) then
      new.unidades := array[new.unidad_id];
    end if;
  end if;
  if cardinality(new.unidades) = 0 and new.unidad_id is not null then
    new.unidades := array[new.unidad_id];
  elsif cardinality(new.unidades) > 0 and (new.unidad_id is null or not (new.unidad_id = any(new.unidades))) then
    new.unidad_id := new.unidades[1];
  end if;
  return new;
end $$;
drop trigger if exists perfil_unidades on perfiles;
create trigger perfil_unidades before insert or update on perfiles
  for each row execute function tg_perfil_unidades();

create or replace function unidades_actuales() returns uuid[]
language sql stable security definer set search_path = public as $$
  select unidades from perfiles where user_id = usuario_sesion() and activo
$$;

-- El admin ve y graba en todas las unidades; capturador e invitado, en las suyas.
create or replace function unidad_permitida(p_unidad uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(rol_actual() = 'admin', false)
      or (p_unidad is not null and p_unidad = any(coalesce(unidades_actuales(), '{}')))
$$;

revoke execute on function unidades_actuales() from public;
grant execute on function unidades_actuales() to authenticated;
