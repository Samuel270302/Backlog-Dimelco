-- Reprogramación directa: cambiar_estado_backlog acepta Programado -> Programado
-- con otra fecha y motivo, en un solo llamado (antes había que pasar por Listo para
-- programar). Suma 1 a reprogramaciones, mantiene la OT y deja en la bitácora
-- "fecha anterior -> fecha nueva · motivo". Reemplaza la función de 004.
--
--   Programado -> Programado (admin: fecha_programada nueva, motivo)

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
  v_detalle  text;
  v_fecha_ant date;
begin
  select * into b from backlogs where id = p_id for update;
  if not found then
    raise exception 'Backlog inexistente';
  end if;
  v_anterior := b.estado;
  if v_rol is null or v_rol = 'invitado' or not unidad_permitida(b.unidad_id) then
    raise exception 'Sin permiso para cambiar este backlog';
  end if;
  if p_estado = b.estado and p_estado <> 'Programado' then
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
    or (b.estado = 'Programado'           and p_estado in ('Ejecutado','Listo para programar','Programado'))
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
      if b.estado = 'Programado' then
        -- Reprogramación directa: otra fecha, misma OT, con motivo.
        v_fecha_ant := b.fecha_programada;
        if v_motivo is null then
          raise exception 'Indique el motivo de la reprogramación';
        end if;
        if (p_datos->>'fecha_programada') is null or (p_datos->>'fecha_programada')::date = v_fecha_ant then
          raise exception 'Indique una fecha programada distinta a la actual';
        end if;
        b.reprogramaciones := b.reprogramaciones + 1;
        v_tipo_ev := 'reprogramación';
        v_detalle := format('%s → %s', to_char(v_fecha_ant, 'DD/MM/YYYY'),
                            to_char((p_datos->>'fecha_programada')::date, 'DD/MM/YYYY'));
      end if;
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
  values (b.id, v_tipo_ev, v_anterior, p_estado, nullif(concat_ws(' · ', v_detalle, v_motivo, v_coment), ''));

  perform set_config('backlog.transicion', 'no', true);
  return b;
end $$;
