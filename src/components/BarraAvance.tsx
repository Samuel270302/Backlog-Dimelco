import { ETAPAS, etapaDe, ESTADOS_PLANEADO, type BacklogEvento, type BacklogFila, type Etapa } from "../lib/types";
import { fFecha } from "../lib/fmt";

// Avance del backlog en las 5 etapas visibles. En modo detallado muestra la fecha de
// cada paso: detección, aprobación, fecha programada, ejecución y validación.
function fechaEtapa(b: BacklogFila, etapa: Etapa, eventos: BacklogEvento[]): string | null {
  const primerEvento = (estados: string[]) => eventos.find((e) => e.estado_nuevo && estados.includes(e.estado_nuevo))?.creado_en;
  switch (etapa) {
    case "Identificado":
      return b.fecha_deteccion;
    case "Planeado":
      return primerEvento(ESTADOS_PLANEADO)?.slice(0, 10) ?? null;
    case "Programado":
      return b.fecha_programada;
    case "Ejecutado":
      return b.fecha_ejecucion;
    case "Validado":
      return primerEvento(["Validado"])?.slice(0, 10) ?? null;
  }
}

export function subestadoPlaneado(b: BacklogFila): string | null {
  if (b.estado === "En planificación") return "En planificación";
  if (b.estado === "Esperando repuestos")
    return `Esperando repuestos (${b.repuestos_total - b.repuestos_pendientes}/${b.repuestos_total} recibidos)`;
  if (b.estado === "Listo para programar") return "Listo para programar";
  return null;
}

export default function BarraAvance({
  b,
  eventos = [],
  detallada = false,
}: {
  b: BacklogFila;
  eventos?: BacklogEvento[];
  detallada?: boolean;
}) {
  const actual = etapaDe(b.estado);
  if (!actual) return <div className="barra-avance anulada">{b.estado}</div>;
  const indice = ETAPAS.indexOf(actual);
  return (
    <ol
      className={`barra-avance${detallada ? " detallada" : ""}`}
      aria-label={`Avance: paso ${indice + 1} de 5, ${actual}`}
    >
      {ETAPAS.map((etapa, i) => {
        const fecha = detallada ? fechaEtapa(b, etapa, eventos) : null;
        return (
          <li
            key={etapa}
            className={i < indice || actual === "Validado" ? "hecho" : i === indice ? "actual" : "pendiente"}
            title={etapa}
          >
            <span className="ba-marca">{i + 1}</span>
            {detallada && (
              <span className="ba-texto">
                <span className="ba-etapa">{etapa}</span>
                <span className="ba-fecha">{i <= indice && fecha ? fFecha(fecha) : etapa === "Programado" && fecha ? `prog. ${fFecha(fecha)}` : ""}</span>
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
