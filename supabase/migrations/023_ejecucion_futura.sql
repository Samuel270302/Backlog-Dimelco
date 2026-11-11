-- Ejecución con fecha futura (11/11/2026): "Marcar ejecutado" admite fechas anteriores y
-- posteriores a hoy. En un backlog la fecha de ejecución no puede ser anterior a su
-- fecha de detección; en un preventivo no hay límite. Cambia solo esa validación de
-- cambiar_estado_backlog (018) y cambiar_estado_preventivo (021). Se puede repetir.
do $$
declare
  f text;
  v_viejo text := $t$if v_fecha > hoy() then
          raise exception 'La fecha de ejecución no puede ser futura';
        end if;$t$;
begin
  select pg_get_functiondef(p.oid) into f
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'cambiar_estado_backlog';
  if position('anterior a la fecha de detección (%)'', to_char(b.fecha_deteccion' in f) = 0
     or position('no puede ser futura' in f) > 0 then
    if position(v_viejo in f) = 0 then
      raise exception '023: cambiar_estado_backlog no tiene la validación esperada de la fecha de ejecución';
    end if;
    f := replace(f, v_viejo, $t$if v_fecha < b.fecha_deteccion then
          raise exception 'La fecha de ejecución no puede ser anterior a la fecha de detección (%)', to_char(b.fecha_deteccion, 'DD/MM/YYYY');
        end if;$t$);
    execute f;
  end if;
end $$;

do $$
declare
  f text;
  v_viejo text := $t$    if v_fecha > hoy() then
      raise exception 'La fecha de ejecución no puede ser futura';
    end if;
$t$;
begin
  select pg_get_functiondef(p.oid) into f
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'cambiar_estado_preventivo';
  if position('no puede ser futura' in f) > 0 then
    if position(v_viejo in f) = 0 then
      raise exception '023: cambiar_estado_preventivo no tiene la validación esperada de la fecha de ejecución';
    end if;
    execute replace(f, v_viejo, '');
  end if;
end $$;
