-- Fotos de backlog en Supabase Storage: bucket privado backlog-fotos.
-- Ruta: <unidad_id>/<backlog_id>/<archivo>.jpg; la carpeta raíz decide la unidad.

do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'Sin esquema storage: se omite 007 (base local)';
    return;
  end if;

  insert into storage.buckets (id, name, public)
  values ('backlog-fotos', 'backlog-fotos', false)
  on conflict (id) do nothing;

  drop policy if exists leer_backlog_fotos on storage.objects;
  create policy leer_backlog_fotos on storage.objects for select to authenticated
    using (bucket_id = 'backlog-fotos' and rol_actual() is not null
           and unidad_permitida(((storage.foldername(name))[1])::uuid));

  drop policy if exists subir_backlog_fotos on storage.objects;
  create policy subir_backlog_fotos on storage.objects for insert to authenticated
    with check (bucket_id = 'backlog-fotos' and rol_actual() in ('admin','capturador')
                and unidad_permitida(((storage.foldername(name))[1])::uuid)
                and unidad_de_backlog(((storage.foldername(name))[2])::uuid) = ((storage.foldername(name))[1])::uuid);

  drop policy if exists borrar_backlog_fotos on storage.objects;
  create policy borrar_backlog_fotos on storage.objects for delete to authenticated
    using (bucket_id = 'backlog-fotos' and rol_actual() = 'admin');
end $$;
