-- Flujo del backlog. El estado solo cambia por esta función, que revisa rol,
-- unidad, transición permitida y datos obligatorios, y deja el evento en la bitácora.
--
--   Identificado         -> En planificación (admin: HH estimadas cargadas) | Rechazado (admin, motivo)
--   En planificación     -> Esperando repuestos (admin: hay repuestos sin recibir)
--                         | Listo para programar (admin: sin repuestos o todos recibidos)
--   Esperando repuestos  -> Listo para programar (automático al recibir el último, o admin)
--                         | En planificación (admin)
--   Listo para programar -> Programado (admin: semana, fecha y OT) | En planificación (admin)
--   Programado           -> Ejecutado (admin o capturador: fecha y HH reales)
--                         | Listo para programar (admin, motivo: reprogramación)
--   Ejecutado            -> Cerrado (admin)
--   Cualquier estado abierto -> Anulado (admin, motivo)
--
-- p_datos (jsonb, todo opcional salvo lo que pida la transición):
--   prioridad, motivo, comentario, semana_programada, fecha_programada, ot_sap,
--   aprovechar_pm, fecha_ejecucion

create or replace function cambiar_estado_backlog(p_id uuid, p_estado text, p_datos jsonb default '{}'::jsonb)
returns backlogs
language plpgsql security definer set search_path = public as $$
declare
  b          backlogs;
  v_rol      text := rol_actual();
  v_motivo   text := nullif(trim(p_datos->>'motivo'), '');
  v_coment   text := nullif(trim(p_datos->>'comentario'), '');
  v_tipo_ev  text := 'estado';
  v_pend     integer;
  v_total    integer;
  v_fecha    date;
  v_semana   date;
  v_anterior text;
begin
  select * into b from backlogs where id = p_id for update;
  if not found then
    raise exception 'Backlog inexistente';
  end if;
  v_anterior := b.estado;
  if v_rol is null or v_rol = 'invitado' or not unidad_permitida(b.unidad_id) then
    raise exception 'Sin permiso para cambiar este backlog';
  end if;
  if p_estado = b.estado then
    raise exception 'El backlog ya está %', b.estado;
  end if;

  select count(*), count(*) filter (where estado <> 'Recibido')
    into v_total, v_pend
  from backlog_repuestos where backlog_id = b.id;

  -- Transiciones permitidas y quién las hace
  if not (
       (b.estado = 'Identificado'         and p_estado in ('En planificación','Rechazado'))
    or (b.estado = 'En planificación'     and p_estado in ('Esperando repuestos','Listo para programar'))
    or (b.estado = 'Esperando repuestos'  and p_estado in ('Listo para programar','En planificación'))
    or (b.estado = 'Listo para programar' and p_estado in ('Programado','En planificación'))
    or (b.estado = 'Programado'           and p_estado in ('Ejecutado','Listo para programar'))
    or (b.estado = 'Ejecutado'            and p_estado = 'Cerrado')
    or (b.estado in ('Identificado','En planificación','Esperando repuestos','Listo para programar','Programado')
        and p_estado = 'Anulado')
  ) then
    raise exception 'No se puede pasar de % a %', b.estado, p_estado;
  end if;
  if v_rol <> 'admin' and not (b.estado = 'Programado' and p_estado = 'Ejecutado') then
    raise exception 'Solo el administrador puede pasar de % a %', b.estado, p_estado;
  end if;

  perform set_config('backlog.transicion', 'si', true);

  if p_datos ? 'prioridad' and b.estado in ('Identificado','En planificación') then
    b.prioridad := p_datos->>'prioridad';
  end if;

  case p_estado
    when 'En planificación' then
      if b.estado = 'Identificado'
         and not exists (select 1 from backlog_hh where backlog_id = b.id and tipo = 'estimada') then
        raise exception 'Cargue las HH estimadas por especialidad antes de planificar';
      end if;
    when 'Esperando repuestos' then
      if v_pend = 0 then
        raise exception 'No hay repuestos pendientes de recibir';
      end if;
    when 'Listo para programar' then
      if v_pend > 0 then
        raise exception 'Faltan % repuesto(s) por recibir', v_pend;
      end if;
      if b.estado = 'Programado' then
        if v_motivo is null then
          raise exception 'Indique el motivo de la reprogramación';
        end if;
        b.reprogramaciones := b.reprogramaciones + 1;
        b.semana_programada := null;
        b.fecha_programada := null;
        v_tipo_ev := 'reprogramación';
      end if;
    when 'Programado' then
      v_fecha := coalesce((p_datos->>'fecha_programada')::date, b.fecha_programada);
      v_semana := coalesce((p_datos->>'semana_programada')::date, date_trunc('week', v_fecha)::date);
      b.ot_sap := coalesce(nullif(trim(p_datos->>'ot_sap'), ''), b.ot_sap);
      if v_fecha is null or b.ot_sap is null then
        raise exception 'Para programar indique fecha programada y OT SAP';
      end if;
      if v_fecha < hoy() then
        raise exception 'La fecha programada no puede ser pasada';
      end if;
      if date_trunc('week', v_fecha)::date <> v_semana then
        raise exception 'La fecha programada no cae en la semana indicada';
      end if;
      b.fecha_programada := v_fecha;
      b.semana_programada := v_semana;
      b.aprovechar_pm := coalesce((p_datos->>'aprovechar_pm')::boolean, b.aprovechar_pm);
    when 'Ejecutado' then
      v_fecha := (p_datos->>'fecha_ejecucion')::date;
      if v_fecha is null then
        raise exception 'Indique la fecha de ejecución';
      end if;
      if v_fecha > hoy() then
        raise exception 'La fecha de ejecución no puede ser futura';
      end if;
      if not exists (select 1 from backlog_hh where backlog_id = b.id and tipo = 'real') then
        raise exception 'Cargue las HH reales por especialidad antes de marcar ejecutado';
      end if;
      b.fecha_ejecucion := v_fecha;
    when 'Rechazado', 'Anulado' then
      if v_motivo is null then
        raise exception 'Indique el motivo';
      end if;
      b.motivo_anulacion := v_motivo;
    else
      null;
  end case;

  update backlogs set
    estado = p_estado,
    prioridad = b.prioridad,
    ot_sap = b.ot_sap,
    semana_programada = b.semana_programada,
    fecha_programada = b.fecha_programada,
    aprovechar_pm = b.aprovechar_pm,
    fecha_ejecucion = b.fecha_ejecucion,
    reprogramaciones = b.reprogramaciones,
    motivo_anulacion = b.motivo_anulacion
  where id = b.id
  returning * into b;

  insert into backlog_eventos (backlog_id, tipo, estado_anterior, estado_nuevo, texto)
  values (b.id, v_tipo_ev, v_anterior, p_estado, nullif(concat_ws(' · ', v_motivo, v_coment), ''));

  perform set_config('backlog.transicion', 'no', true);
  return b;
end $$;

-- Repuestos: al recibir el último, el backlog en Esperando repuestos pasa solo a
-- Listo para programar; si a uno Listo se le agrega un repuesto sin recibir, vuelve a esperar.
create or replace function tg_repuestos_estado() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_id     uuid := coalesce(new.backlog_id, old.backlog_id);
  v_estado text;
  v_pend   integer;
  v_total  integer;
  v_nuevo  text;
begin
  select estado into v_estado from backlogs where id = v_id;
  select count(*), count(*) filter (where estado <> 'Recibido') into v_total, v_pend
  from backlog_repuestos where backlog_id = v_id;
  if v_estado = 'Esperando repuestos' and v_total > 0 and v_pend = 0 then
    v_nuevo := 'Listo para programar';
  elsif v_estado = 'Listo para programar' and v_pend > 0 then
    v_nuevo := 'Esperando repuestos';
  end if;
  if v_nuevo is not null then
    perform set_config('backlog.transicion', 'si', true);
    update backlogs set estado = v_nuevo where id = v_id;
    perform set_config('backlog.transicion', 'no', true);
    insert into backlog_eventos (backlog_id, tipo, estado_anterior, estado_nuevo, texto)
    values (v_id, 'estado', v_estado, v_nuevo,
            case when v_pend = 0 then 'Automático: todos los repuestos recibidos'
                 else 'Automático: se agregó un repuesto sin recibir' end);
  end if;
  return null;
end $$;

drop trigger if exists repuestos_estado on backlog_repuestos;
create trigger repuestos_estado after insert or update or delete on backlog_repuestos
  for each row execute function tg_repuestos_estado();
