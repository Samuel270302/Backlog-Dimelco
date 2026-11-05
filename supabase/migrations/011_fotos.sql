-- Fotos: suben admin y capturador de la unidad; borra solo el admin, igual que el
-- archivo en Storage (007). Antes la política "for all" de 006 dejaba al capturador
-- borrar la fila aunque no pudiera borrar el archivo.

drop policy if exists editar_backlog_fotos on backlog_fotos;

drop policy if exists subir_backlog_fotos on backlog_fotos;
create policy subir_backlog_fotos on backlog_fotos for insert to authenticated
  with check (rol_actual() in ('admin','capturador') and unidad_permitida(unidad_de_backlog(backlog_id))
              and creado_por = usuario_sesion());

drop policy if exists cambiar_backlog_fotos on backlog_fotos;
create policy cambiar_backlog_fotos on backlog_fotos for update to authenticated
  using (rol_actual() in ('admin','capturador') and unidad_permitida(unidad_de_backlog(backlog_id)))
  with check (rol_actual() in ('admin','capturador') and unidad_permitida(unidad_de_backlog(backlog_id)));

drop policy if exists borrar_backlog_fotos on backlog_fotos;
create policy borrar_backlog_fotos on backlog_fotos for delete to authenticated
  using (rol_actual() = 'admin' and unidad_permitida(unidad_de_backlog(backlog_id)));
