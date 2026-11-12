-- Quitar fotos (12/11/2026): el administrador y el capturador de la unidad quitan fotos
-- de un backlog de Identificado a Ejecutado. En Validado, Rechazado y Anulado el
-- disparador tg_detalle_editable (003/010) ya lo impide. Cada foto quitada deja un
-- evento "foto" en la bitácora con quién la quitó. Se puede repetir.

drop policy if exists borrar_backlog_fotos on backlog_fotos;
create policy borrar_backlog_fotos on backlog_fotos for delete to authenticated
  using (rol_actual() in ('admin','capturador') and unidad_permitida(unidad_de_backlog(backlog_id)));

-- Archivo en Storage: misma regla; el backlog (carpeta 2) debe estar abierto y no borrado.
create or replace function backlog_admite_fotos(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from backlogs
                 where id = p_id and borrado_en is null
                   and estado in ('Identificado','En planificación','Esperando repuestos',
                                  'Listo para programar','Programado','Ejecutado'))
$$;
grant execute on function backlog_admite_fotos(uuid) to authenticated;

do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'Sin esquema storage: se omite la política de Storage de 024';
    return;
  end if;
  drop policy if exists borrar_backlog_fotos on storage.objects;
  create policy borrar_backlog_fotos on storage.objects for delete to authenticated
    using (bucket_id = 'backlog-fotos'
           and (rol_actual() = 'admin'
                or (rol_actual() = 'capturador'
                    and unidad_permitida(((storage.foldername(name))[1])::uuid)
                    and backlog_admite_fotos(((storage.foldername(name))[2])::uuid))));
end $$;

alter table backlog_eventos drop constraint if exists backlog_eventos_tipo_check;
alter table backlog_eventos add constraint backlog_eventos_tipo_check
  check (tipo in ('estado','comentario','repuesto','reprogramación','borrado','restaurado','foto'));

create or replace function tg_foto_quitada() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r backlog_repuestos;
begin
  if old.repuesto_id is not null then
    select * into r from backlog_repuestos where id = old.repuesto_id;
  end if;
  insert into backlog_eventos (backlog_id, tipo, texto, usuario)
  values (old.backlog_id, 'foto',
          case when r.id is not null
               then format('Foto quitada (Ítem %s · %s)', r.item, coalesce(r.numero_parte, r.cod_sap, r.descripcion, ''))
               when old.repuesto_id is not null then 'Foto de repuesto quitada'
               else 'Foto general quitada' end,
          usuario_sesion());
  return old;
end $$;
drop trigger if exists foto_quitada on backlog_fotos;
create trigger foto_quitada after delete on backlog_fotos
  for each row execute function tg_foto_quitada();
