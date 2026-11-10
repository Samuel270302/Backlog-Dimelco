-- Programar y reprogramar con fecha anterior a hoy (10/11/2026): se puede registrar
-- una programación pasada, pero no antes de la fecha en que se reportó el backlog
-- (fecha_deteccion). Cambia solo esa validación de cambiar_estado_backlog (018).
-- Se puede repetir.
do $$
declare
  f text;
begin
  select pg_get_functiondef(p.oid) into f
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'cambiar_estado_backlog';
  f := replace(f, 'if v_fecha < hoy() then', 'if v_fecha < b.fecha_deteccion then');
  f := replace(f, $t$raise exception 'La fecha programada no puede ser pasada';$t$,
    $t$raise exception 'La fecha programada no puede ser anterior a la fecha de detección (%)', to_char(b.fecha_deteccion, 'DD/MM/YYYY');$t$);
  execute f;
end $$;
