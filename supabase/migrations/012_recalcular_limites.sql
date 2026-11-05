-- Recalcula la fecha límite de los backlogs abiertos con los plazos vigentes por
-- prioridad (parametros plazo_pN_dias). Solo el admin. Devuelve cuántos cambiaron.
-- Sin esto, un plazo nuevo solo rige para backlogs nuevos o que cambian de prioridad.

create or replace function recalcular_fechas_limite() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_n integer;
begin
  if coalesce(rol_actual(), '') <> 'admin' then
    raise exception 'Solo el administrador puede recalcular las fechas límite';
  end if;
  update backlogs
     set fecha_limite = fecha_deteccion + plazo_prioridad(prioridad)
   where estado in ('Identificado','En planificación','Esperando repuestos','Listo para programar','Programado')
     and fecha_limite is distinct from fecha_deteccion + plazo_prioridad(prioridad);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke execute on function recalcular_fechas_limite() from public;
grant execute on function recalcular_fechas_limite() to authenticated;
