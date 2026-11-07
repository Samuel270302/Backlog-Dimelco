import { useEffect, useRef, useState } from "react";
import { PRIORIDADES, nombrePrioridad, type Prioridad } from "../lib/types";
import type { Transicion } from "../lib/backlog";
import { hoyISO } from "../lib/fmt";

// Pide los datos que exige el estado destino y un comentario opcional.
// onAceptar recibe el p_datos de cambiar_estado_backlog().
export default function DialogoTransicion({
  folio,
  transicion,
  prioridadActual,
  otActual,
  usaSap = true,
  fechaInicial,
  ocupado,
  onAceptar,
  onCerrar,
}: {
  folio: string;
  transicion: Transicion;
  prioridadActual: Prioridad;
  otActual: string | null;
  usaSap?: boolean;
  fechaInicial?: string;
  ocupado: boolean;
  onAceptar: (datos: Record<string, unknown>) => void;
  onCerrar: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  const pide = (c: Transicion["campos"][number]) => transicion.campos.includes(c);
  const [prioridad, setPrioridad] = useState<Prioridad>(prioridadActual);
  const [fechaProg, setFechaProg] = useState(fechaInicial ?? "");
  const [ot, setOt] = useState(otActual ?? "");
  const [aprovecharPm, setAprovecharPm] = useState(false);
  const [fechaEjec, setFechaEjec] = useState(hoyISO());
  const [motivo, setMotivo] = useState("");
  const [comentario, setComentario] = useState("");

  const faltantes: string[] = [];
  if (pide("fecha_programada") && !fechaProg) faltantes.push("fecha programada");
  if (pide("ot_sap") && !ot.trim()) faltantes.push(usaSap ? "OT SAP" : "N° OT");
  if (pide("fecha_ejecucion") && !fechaEjec) faltantes.push("fecha de ejecución");
  if (pide("motivo") && motivo.trim().length < 3) faltantes.push("motivo");

  function aceptar() {
    const datos: Record<string, unknown> = {};
    if (pide("prioridad")) datos.prioridad = prioridad;
    if (pide("fecha_programada")) datos.fecha_programada = fechaProg;
    if (pide("ot_sap")) datos.ot_sap = ot.trim();
    if (pide("aprovechar_pm")) datos.aprovechar_pm = aprovecharPm;
    if (pide("fecha_ejecucion")) datos.fecha_ejecucion = fechaEjec;
    if (pide("motivo")) datos.motivo = motivo.trim();
    if (comentario.trim()) datos.comentario = comentario.trim();
    onAceptar(datos);
  }

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onCerrar();
      }}
    >
      <h1 style={{ fontSize: 16 }}>
        {transicion.etiqueta} · {folio}
      </h1>
      <p className="nota" style={{ marginTop: 0 }}>
        {transicion.etiqueta === "Reprogramar" ? "Cambia la fecha programada." : `${transicion.atras ? "Vuelve" : "Pasa"} a «${transicion.destino}».`}
        {transicion.atras && " Indique el motivo: queda en la bitácora."}
        {!transicion.atras && transicion.destino === "En planificación" && " Revise la prioridad: la fecha límite se recalcula con ella."}
        {!transicion.atras && transicion.destino === "Ejecutado" && " Antes deben estar cargadas las HH reales por especialidad."}
        {transicion.destino === "Validado" && " Una vez validado, el capturador ya no puede cambiarlo; solo el administrador lo revierte o lo borra."}
        {transicion.etiqueta === "Reprogramar" && " Se mantiene la OT y queda registrada la reprogramación."}
      </p>
      {pide("prioridad") && (
        <label className="campo">
          <span>Prioridad confirmada</span>
          <select value={prioridad} onChange={(e) => setPrioridad(e.target.value as Prioridad)}>
            {PRIORIDADES.map((p) => (
              <option key={p} value={p}>{nombrePrioridad(p)}</option>
            ))}
          </select>
        </label>
      )}
      {pide("fecha_programada") && (
        <label className="campo">
          <span>Fecha programada</span>
          <input type="date" min={hoyISO()} value={fechaProg} onChange={(e) => setFechaProg(e.target.value)} />
        </label>
      )}
      {pide("ot_sap") && (
        <label className="campo">
          <span>{usaSap ? "OT SAP" : "N° OT"}</span>
          <input value={ot} onChange={(e) => setOt(e.target.value)} placeholder="Número de orden de trabajo" />
        </label>
      )}
      {pide("aprovechar_pm") && (
        <label className="campo-check">
          <input type="checkbox" checked={aprovecharPm} onChange={(e) => setAprovecharPm(e.target.checked)} />
          Aprovechar la parada de un PM
        </label>
      )}
      {pide("fecha_ejecucion") && (
        <label className="campo">
          <span>Fecha de ejecución</span>
          <input type="date" max={hoyISO()} value={fechaEjec} onChange={(e) => setFechaEjec(e.target.value)} />
        </label>
      )}
      {pide("motivo") && (
        <label className="campo">
          <span>Motivo</span>
          <textarea rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus />
        </label>
      )}
      <label className="campo">
        <span>Comentario (opcional, queda en la bitácora)</span>
        <textarea rows={2} value={comentario} onChange={(e) => setComentario(e.target.value)} />
      </label>
      {faltantes.length > 0 && <p className="nota">Falta: {faltantes.join(", ")}.</p>}
      <div className="barra-acciones" style={{ marginBottom: 0 }}>
        <div className="espacio" />
        <button className="boton-plano" onClick={onCerrar}>
          Cancelar
        </button>
        <button
          className={transicion.peligro ? "boton-peligro" : undefined}
          disabled={ocupado || faltantes.length > 0}
          onClick={aceptar}
        >
          {ocupado ? "Grabando…" : transicion.etiqueta}
        </button>
      </div>
    </dialog>
  );
}
