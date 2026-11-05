import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useSistemas } from "../../lib/queries";
import { useUnidades } from "../../lib/unidad";
import { useAvisos } from "../Avisos";
import { marcarPendientes } from "../../lib/pendientes";
import { fFecha, hoyISO } from "../../lib/fmt";
import { ORIGENES, PRIORIDADES, type BacklogFila, type Origen, type Prioridad } from "../../lib/types";

const editables = (b: BacklogFila) => ({
  sistema_id: b.sistema_id,
  origen: b.origen,
  prioridad: b.prioridad,
  fecha_deteccion: b.fecha_deteccion,
  reportado_por: b.reportado_por ?? "",
  aviso_sap: b.aviso_sap ?? "",
  ot_sap: b.ot_sap ?? "",
  descripcion: b.descripcion,
});

export default function DatosBacklog({ b, editable }: { b: BacklogFila; editable: boolean }) {
  const qc = useQueryClient();
  const { avisar } = useAvisos();
  const { data: sistemas } = useSistemas();
  const { data: unidades } = useUnidades();
  const [f, setF] = useState(() => editables(b));
  const original = JSON.stringify(editables(b));
  const sucio = JSON.stringify(f) !== original;

  // Si otro usuario cambia el backlog y aquí no hay nada escrito, se toma lo nuevo.
  useEffect(() => {
    if (!sucio) setF(editables(b));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [original]);
  useEffect(() => {
    marcarPendientes(sucio ? 1 : 0);
    return () => marcarPendientes(0);
  }, [sucio]);

  const grabar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase()
        .from("backlogs")
        .update({
          sistema_id: f.sistema_id,
          origen: f.origen,
          prioridad: f.prioridad,
          fecha_deteccion: f.fecha_deteccion,
          reportado_por: f.reportado_por.trim() || null,
          aviso_sap: f.aviso_sap.trim() || null,
          ot_sap: f.ot_sap.trim() || null,
          descripcion: f.descripcion.trim(),
        })
        .eq("id", b.id);
      if (error) throw error;
    },
    onSuccess: () => {
      marcarPendientes(0);
      qc.invalidateQueries();
      avisar("Datos grabados");
    },
    onError: (e: Error) => avisar(e.message, "error"),
  });

  const campo = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const unidad = unidades?.find((u) => u.id === b.unidad_id)?.nombre ?? "";

  return (
    <div className="bloque-ficha">
      <dl className="datos-fijos">
        <div><dt>Equipo</dt><dd><Link to={`/equipo/${b.equipo_id}`}>{b.cod_interno}</Link> · {b.modelo}</dd></div>
        <div><dt>Unidad</dt><dd>{unidad}</dd></div>
        <div><dt>Fecha límite</dt><dd className={b.vencido ? "texto-vencido" : undefined}>{fFecha(b.fecha_limite)}{b.vencido && " (vencido)"}</dd></div>
        <div><dt>Antigüedad</dt><dd>{b.antiguedad_dias} días</dd></div>
        {b.fecha_programada && <div><dt>Programado para</dt><dd>{fFecha(b.fecha_programada)}{b.aprovechar_pm && " · con PM"}</dd></div>}
        {b.reprogramaciones > 0 && <div><dt>Reprogramaciones</dt><dd>{b.reprogramaciones}</dd></div>}
        {b.fecha_ejecucion && <div><dt>Ejecutado</dt><dd>{fFecha(b.fecha_ejecucion)}</dd></div>}
        {b.motivo_anulacion && <div><dt>Motivo</dt><dd>{b.motivo_anulacion}</dd></div>}
      </dl>

      <fieldset disabled={!editable} className="sin-borde">
        <label className="campo">
          <span>Descripción</span>
          <textarea rows={3} value={f.descripcion} onChange={(e) => campo("descripcion", e.target.value)} />
        </label>
        <div className="fila-campos">
          <label className="campo">
            <span>Sistema</span>
            <select value={f.sistema_id} onChange={(e) => campo("sistema_id", e.target.value)}>
              {(sistemas ?? []).filter((s) => s.activo || s.id === f.sistema_id).map((s) => (
                <option key={s.id} value={s.id}>{s.nombre}</option>
              ))}
            </select>
          </label>
          <label className="campo">
            <span>Origen</span>
            <select value={f.origen} onChange={(e) => campo("origen", e.target.value as Origen)}>
              {ORIGENES.map((o) => <option key={o}>{o}</option>)}
            </select>
          </label>
          <label className="campo">
            <span>Prioridad</span>
            <select value={f.prioridad} onChange={(e) => campo("prioridad", e.target.value as Prioridad)}>
              {PRIORIDADES.map((p) => <option key={p}>{p}</option>)}
            </select>
          </label>
          <label className="campo">
            <span>Fecha de detección</span>
            <input type="date" max={hoyISO()} value={f.fecha_deteccion} onChange={(e) => campo("fecha_deteccion", e.target.value)} />
          </label>
        </div>
        <div className="fila-campos">
          <label className="campo">
            <span>Reportado por</span>
            <input value={f.reportado_por} onChange={(e) => campo("reportado_por", e.target.value)} />
          </label>
          <label className="campo">
            <span>Aviso SAP</span>
            <input value={f.aviso_sap} onChange={(e) => campo("aviso_sap", e.target.value)} />
          </label>
          <label className="campo">
            <span>OT SAP</span>
            <input value={f.ot_sap} onChange={(e) => campo("ot_sap", e.target.value)} />
          </label>
        </div>
      </fieldset>
      {editable && (
        <div className="barra-acciones">
          <div className="espacio" />
          <button className="boton-plano" disabled={!sucio} onClick={() => setF(editables(b))}>
            Deshacer
          </button>
          <button disabled={!sucio || f.descripcion.trim().length < 5 || grabar.isPending} onClick={() => grabar.mutate()}>
            {grabar.isPending ? "Grabando…" : "Grabar datos"}
          </button>
        </div>
      )}
    </div>
  );
}
