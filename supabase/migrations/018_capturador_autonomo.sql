-- Capturador autónomo (07/11/2026): el capturador avanza y retrocede los estados sin
-- depender del administrador (aprobar, esperar repuestos, programar, reprogramar,
-- ejecutar, validar, rechazar y anular) y edita el backlog mientras está abierto.
-- Una vez Validado, Rechazado o Anulado, el backlog queda bloqueado para el
-- capturador: solo el administrador lo revierte o lo borra.
-- Cada retroceso pide motivo y queda en la bitácora. Se puede repetir.
--
-- Flujo:
--   Identificado         -> En planificación | Rechazado | Anulado
--   En planificación     -> Esperando repuestos | Listo para programar | Identificado (atrás) | Anulado
--   Esperando repuestos  -> Listo para programar | En planificación (atrás) | Anulado
--   Listo para programar -> Programado | En planificación (atrás) | Anulado
--   Programado           -> Ejecutado | Programado (reprogramar) | Listo para programar (atrás) | Anulado
--   Ejecutado            -> Validado | Programado (atrás)
--   Validado             -> Ejecutado (atrás, solo admin)
--   Rechazado, Anulado   -> Identificado (reabrir, solo admin)

create or replace function cambiar_estado_backlog(p_id uuid, p_estado text, p_datos jsonb default '{}'::jsonb)
returns backlogs
language plpgsql security definer set search_path = public as $$
declare
  b           backlogs;
  v_rol       text := rol_actual();
  v_motivo    text := nullif(trim(p_datos->>'motivo'), '');
  v_coment    text := nullif(trim(p_datos->>'comentario'), '');
  v_tipo_ev   text := 'estado';
  v_pend      integer;
  v_total     integer;
  v_fecha     date;
  v_semana    date;
  v_anterior  text;
  v_detalle   text;
  v_fecha_ant date;
  v_atras     boolean;
begin
  select * into b from backlogs where id = p_id for update;
  if not found then
    raise exception 'Backlog inexistente';
  end if;
  if b.borrado_en is not null then
    raise exception 'El backlog % está borrado: no se edita', b.folio;
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

  if not (
       (b.estado = 'Identificado'         and p_estado in ('En planificación','Rechazado','Anulado'))
    or (b.estado = 'En planificación'     and p_estado in ('Esperando repuestos','Listo para programar','Identificado','Anulado'))
    or (b.estado = 'Esperando repuestos'  and p_estado in ('Listo para programar','En planificación','Anulado'))
    or (b.estado = 'Listo para programar' and p_estado in ('Programado','En planificación','Anulado'))
    or (b.estado = 'Programado'           and p_estado in ('Ejecutado','Listo para programar','Programado','Anulado'))
    or (b.estado = 'Ejecutado'            and p_estado in ('Validado','Programado'))
    or (b.estado = 'Validado'             and p_estado = 'Ejecutado')
    or (b.estado in ('Rechazado','Anulado') and p_estado = 'Identificado')
  ) then
    raise exception 'No se puede pasar de % a %', b.estado, p_estado;
  end if;

  -- Validado, Rechazado y Anulado quedan bloqueados para el capturador.
  if v_rol <> 'admin' and b.estado in ('Validado','Rechazado','Anulado') then
    raise exception 'El backlog está %: solo el administrador puede revertirlo', b.estado;
  end if;

  -- Retrocesos: piden motivo.
  v_atras := (b.estado = 'En planificación' and p_estado = 'Identificado')
          or (b.estado in ('Esperando repuestos','Listo para programar') and p_estado = 'En planificación')
          or (b.estado = 'Programado' and p_estado = 'Listo para programar')
          or (b.estado = 'Ejecutado' and p_estado = 'Programado')
          or (b.estado = 'Validado' and p_estado = 'Ejecutado')
          or (b.estado in ('Rechazado','Anulado') and p_estado = 'Identificado');
  if v_atras and v_motivo is null then
    raise exception 'Indique el motivo para volver a %', p_estado;
  end if;

  perform set_config('backlog.transicion', 'si', true);

  if p_datos ? 'prioridad' and b.estado in ('Identificado','En planificación') then
    b.prioridad := p_datos->>'prioridad';
  end if;

  case p_estado
    when 'Identificado' then
      -- Reabrir un rechazado o anulado, o volver desde planificación.
      b.motivo_anulacion := null;
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
      if v_pend > 0 and b.estado <> 'Programado' then
        raise exception 'Faltan % repuesto(s) por recibir', v_pend;
      end if;
      if b.estado = 'Programado' then
        b.reprogramaciones := b.reprogramaciones + 1;
        b.semana_programada := null;
        b.fecha_programada := null;
        v_tipo_ev := 'reprogramación';
      end if;
    when 'Programado' then
      if b.estado = 'Ejecutado' then
        -- Vuelve a programado: se borra la fecha de ejecución; fecha y OT se mantienen.
        b.fecha_ejecucion := null;
      else
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
          raise exception 'Para programar indique fecha programada y N° de OT';
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
      end if;
    when 'Ejecutado' then
      if b.estado = 'Programado' then
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
      end if;
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
  values (b.id, v_tipo_ev, v_anterior, p_estado,
          nullif(concat_ws(' · ', case when v_atras then 'Retroceso' end, v_detalle, v_motivo, v_coment), ''));

  perform set_config('backlog.transicion', 'no', true);
  return b;
end $$;

revoke execute on function cambiar_estado_backlog(uuid, text, jsonb) from public;
grant execute on function cambiar_estado_backlog(uuid, text, jsonb) to authenticated;

-- Editar el backlog: el capturador mientras esté abierto (antes solo en Identificado).
drop policy if exists editar_backlogs on backlogs;
create policy editar_backlogs on backlogs for update to authenticated
  using (unidad_permitida(unidad_id)
         and (rol_actual() = 'admin'
              or (rol_actual() = 'capturador' and estado not in ('Validado','Rechazado','Anulado'))))
  with check (unidad_permitida(unidad_id));

-- Borrar: el capturador no borra un backlog Validado (solo el administrador).
create or replace function borrar_backlog(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_rol  text := rol_actual();
  b      backlogs;
begin
  select * into b from backlogs where id = p_id for update;
  if not found then
    raise exception 'Backlog inexistente';
  end if;
  if v_rol is null or v_rol not in ('admin', 'capturador') or not unidad_permitida(b.unidad_id) then
    raise exception 'Solo el administrador o un capturador de la unidad pueden borrar el backlog %', b.folio;
  end if;
  if v_rol <> 'admin' and b.estado = 'Validado' then
    raise exception 'El backlog % está Validado: solo el administrador puede borrarlo', b.folio;
  end if;
  if b.borrado_en is not null then
    raise exception 'El backlog % ya está borrado', b.folio;
  end if;
  if length(coalesce(trim(p_motivo), '')) < 5 then
    raise exception 'Indique el motivo del borrado (mínimo 5 letras)';
  end if;
  perform set_config('backlog.borrado', 'si', true);
  perform set_config('backlog.transicion', 'si', true);
  update backlogs
     set borrado_en = now(), borrado_por = usuario_sesion(), motivo_borrado = trim(p_motivo)
   where id = p_id;
  perform set_config('backlog.transicion', 'no', true);
  perform set_config('backlog.borrado', 'no', true);
  insert into backlog_eventos (backlog_id, tipo, estado_anterior, texto, usuario)
  values (p_id, 'borrado', b.estado, 'Borrado: ' || trim(p_motivo), usuario_sesion());
end $$;
