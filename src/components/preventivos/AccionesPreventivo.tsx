import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAvisos } from "../Avisos";
import { fFecha, hoyISO } from "../../lib/fmt";
import {
  ETIQUETA_ACCION,
  cambiarEstadoPreventivo,
  useMaterialesPreventivo,
  type AccionPreventivo,
} from "../../lib/preventivos";
import type { EstadoPreventivo, Preventivo } from "../../lib/types";
import DialogoPreventivo, { type BasePreventivo } from "./DialogoPreventivo";
import TablaMateriales from "./TablaMateriales";

const DESTINO: Record<AccionPreventivo, EstadoPreventivo> = {
  ejecutar: "Ejecutado",
  reprogramar: "Programado",
  anular: "Anulado",
  revertir: "Programado",
};

// Cuadros de preventivos compartidos por la lista, la ficha y el calendario.
export function useAccionesPreventivo() {
  const qc = useQueryClient();
  const { avisar } = useAvisos();
  const [nuevo, setNuevo] = useState<BasePreventivo | null>(null);
  const [pendiente, setPendiente] = useState<{ p: Preventivo; accion: AccionPreventivo; fecha?: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function aplicar(datos: Record<string, unknown>) {
    if (!pendiente) return;
    const { p, accion } = pendiente;
    setOcupado(true);
    try {
      await cambiarEstadoPreventivo(p.id, DESTINO[accion], datos);
      avisar(
        accion === "reprogramar"
          ? `${p.folio}: reprogramado al ${fFecha(String(datos.fecha_programada))}`
          : `${p.folio}: ${DESTINO[accion]}`
      );
      setPendiente(null);
      qc.invalidateQueries();
    } catch (e) {
      avisar((e as Error).message, "error");
    } finally {
      setOcupado(false);
    }
  }

  const dialogo = (
    <>
      {nuevo && (
        <DialogoPreventivo
          base={nuevo}
          onCerrar={() => setNuevo(null)}
          onCreado={(p) => {
            setNuevo(null);
            avisar(`${p.folio} programado · OT ${p.n_ot}`);
            qc.invalidateQueries();
          }}
        />
      )}
      {pendiente && (
        <DialogoAccion
          key={pendiente.p.id + pendiente.accion}
          p={pendiente.p}
          accion={pendiente.accion}
          fechaInicial={pendiente.fecha}
          ocupado={ocupado}
          onAceptar={aplicar}
          onCerrar={() => setPendiente(null)}
        />
      )}
    </>
  );

  return {
    programar: (base: BasePreventivo = {}) => setNuevo(base),
    abrir: (p: Preventivo, accion: AccionPreventivo, fecha?: string) => setPendiente({ p, accion, fecha }),
    dialogo,
  };
}

function DialogoAccion({
  p,
  accion,
  fechaInicial,
  ocupado,
  onAceptar,
  onCerrar,
}: {
  p: Preventivo;
  accion: AccionPreventivo;
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
  const { data: materiales } = useMaterialesPreventivo(accion === "ejecutar" ? p.id : "");
  const [fechaProg, setFechaProg] = useState(fechaInicial ?? "");
  // Propone la fecha programada; se admite cualquier fecha, anterior o posterior a hoy (023).
  const [fechaEjec, setFechaEjec] = useState(p.fecha_programada);
  const [horometro, setHorometro] = useState(p.horometro_ejecucion === null ? "" : String(p.horometro_ejecucion));
  const [ejecutadoPor, setEjecutadoPor] = useState(p.ejecutado_por ?? "");
  const [comentario, setComentario] = useState(p.comentario_cierre ?? "");
  const [motivo, setMotivo] = useState("");

  const pideMotivo = accion !== "ejecutar";
  const faltantes: string[] = [];
  if (accion === "reprogramar" && (!fechaProg || fechaProg === p.fecha_programada)) faltantes.push("una fecha distinta a la actual");
  if (accion === "ejecutar" && !fechaEjec) faltantes.push("fecha de ejecución");
  if (accion === "ejecutar" && horometro.trim() !== "" && !(Number(horometro) >= 0)) faltantes.push("horómetro válido");
  if (pideMotivo && motivo.trim().length < 3) faltantes.push("motivo");

  function aceptar() {
    if (accion === "ejecutar")
      onAceptar({
        fecha_ejecucion: fechaEjec,
        horometro_ejecucion: horometro.trim(),
        ejecutado_por: ejecutadoPor.trim(),
        comentario: comentario.trim(),
      });
    else if (accion === "reprogramar") onAceptar({ fecha_programada: fechaProg, motivo: motivo.trim() });
    else onAceptar({ motivo: motivo.trim() });
  }

  return (
    <dialog
      ref={ref}
      className={accion === "ejecutar" ? "dialogo-ancho" : undefined}
      onCancel={(e) => {
        e.preventDefault();
        onCerrar();
      }}
    >
      <h1 style={{ fontSize: 16 }}>
        {ETIQUETA_ACCION[accion]} · {p.folio}
      </h1>
      <p className="nota" style={{ marginTop: 0 }}>
        {p.cod_interno} · {p.actividad} · programado para el {fFecha(p.fecha_programada)}.
        {accion === "ejecutar" &&
          " Cargue los materiales utilizados antes de marcarlo. Una vez ejecutado, el capturador ya no puede cambiarlo; solo el administrador lo revierte."}
        {accion === "reprogramar" && " Se mantiene la OT y queda registrada la reprogramación."}
        {accion === "revertir" && " Vuelve a Programado para corregirlo."}
      </p>
      {accion === "reprogramar" && (
        <label className="campo">
          <span>Nueva fecha programada</span>
          <input type="date" value={fechaProg} onChange={(e) => setFechaProg(e.target.value)} aria-label="Nueva fecha programada" />
        </label>
      )}
      {accion === "ejecutar" && (
        <>
          <div className="fila-campos">
            <label className="campo">
              <span>Fecha de ejecución</span>
              <input type="date" value={fechaEjec} onChange={(e) => setFechaEjec(e.target.value)} aria-label="Fecha de ejecución del preventivo" />
              {fechaEjec > hoyISO() && <span className="nota">Fecha posterior a hoy: queda registrada como ejecución futura.</span>}
            </label>
            <label className="campo">
              <span>Horómetro al ejecutar (opcional)</span>
              <input type="number" min={0} step="any" value={horometro} onChange={(e) => setHorometro(e.target.value)} aria-label="Horómetro al ejecutar" />
            </label>
            <label className="campo">
              <span>Ejecutado por (opcional)</span>
              <input value={ejecutadoPor} onChange={(e) => setEjecutadoPor(e.target.value)} placeholder="Técnico o cuadrilla" aria-label="Ejecutado por" />
            </label>
          </div>
          <div style={{ marginTop: 12 }}>
            <TablaMateriales
              preventivoId={p.id}
              filas={materiales ?? []}
              editable
              sap={p.usa_sap}
              nota="Filtros, aceites y demás materiales que se usaron. Se graban al agregar o al salir de cada celda."
            />
          </div>
          <label className="campo">
            <span>Comentario de cierre (opcional)</span>
            <textarea rows={2} value={comentario} onChange={(e) => setComentario(e.target.value)} aria-label="Comentario de cierre" />
          </label>
        </>
      )}
      {pideMotivo && (
        <label className="campo">
          <span>Motivo</span>
          <textarea rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus aria-label="Motivo" />
        </label>
      )}
      {faltantes.length > 0 && <p className="nota">Falta: {faltantes.join(", ")}.</p>}
      <div className="barra-acciones" style={{ marginBottom: 0 }}>
        <div className="espacio" />
        <button className="boton-plano" onClick={onCerrar}>
          Cancelar
        </button>
        <button className={accion === "anular" ? "boton-peligro" : undefined} disabled={ocupado || faltantes.length > 0} onClick={aceptar}>
          {ocupado ? "Grabando…" : ETIQUETA_ACCION[accion]}
        </button>
      </div>
    </dialog>
  );
}
