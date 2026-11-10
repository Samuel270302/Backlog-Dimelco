-- Materiales (backlog_repuestos): se agregan, editan y quitan hasta «Listo para
-- programar». Con el backlog Programado o Ejecutado quedan bloqueados (Validado,
-- Rechazado y Anulado ya lo estaban por tg_detalle_editable). Para cambiarlos se
-- vuelve el backlog a Listo para programar. Se puede repetir.
create or replace function tg_repuestos_hasta_listo() returns trigger
language plpgsql as $$
declare
  v_id     uuid;
  v_estado text;
begin
  if tg_op = 'DELETE' then v_id := old.backlog_id; else v_id := new.backlog_id; end if;
  select estado into v_estado from backlogs where id = v_id;
  if v_estado in ('Programado', 'Ejecutado') then
    raise exception 'Con el backlog % los materiales no se editan; vuélvalo a Listo para programar para cambiarlos', v_estado;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists repuestos_hasta_listo on backlog_repuestos;
create trigger repuestos_hasta_listo before insert or update or delete on backlog_repuestos
  for each row execute function tg_repuestos_hasta_listo();
