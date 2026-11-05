-- El estado final "Cerrado" pasa a llamarse "Validado" (pedido del usuario: el
-- flujo visible es Identificado, Planeado, Programado, Ejecutado, Validado).
-- Se cambian los datos, la restricción de estados y cada función y vista que
-- nombra el estado, a partir de su definición actual en la base. Se puede repetir.

alter table backlogs drop constraint if exists backlogs_estado_check;

-- Los datos: el disparador de cambios exige pasar por cambiar_estado_backlog();
-- aquí se marca la transacción como transición autorizada.
do $$
begin
  perform set_config('backlog.transicion', 'si', true);
  update backlogs set estado = 'Validado' where estado = 'Cerrado';
  perform set_config('backlog.transicion', 'no', true);
end $$;
update backlog_eventos set estado_nuevo = 'Validado' where estado_nuevo = 'Cerrado';
update backlog_eventos set estado_anterior = 'Validado' where estado_anterior = 'Cerrado';

alter table backlogs add constraint backlogs_estado_check check (estado in
  ('Identificado','En planificación','Esperando repuestos','Listo para programar',
   'Programado','Ejecutado','Validado','Rechazado','Anulado'));

-- Funciones: cambiar_estado_backlog (de 009), tg_backlog_cambio y tg_detalle_editable (de 003).
do $$
declare
  f text;
begin
  for f in
    select pg_get_functiondef(p.oid)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('cambiar_estado_backlog', 'tg_backlog_cambio', 'tg_detalle_editable')
  loop
    execute replace(f, '''Cerrado''', '''Validado''');
  end loop;
end $$;

-- Vistas: mismas columnas, solo cambia el literal.
do $$
declare
  v text;
begin
  foreach v in array array['v_backlog', 'v_backlog_semanal'] loop
    execute format('create or replace view %I as %s', v,
                   replace(pg_get_viewdef(v::regclass), '''Cerrado''', '''Validado'''));
    execute format('alter view %I set (security_invoker = true)', v);
  end loop;
end $$;
