import { claseEstado } from "../lib/backlog";
import { nombrePrioridad, type Estado, type Prioridad } from "../lib/types";

export function EtiquetaEstado({ estado }: { estado: Estado }) {
  return <span className={`etiqueta-estado ${claseEstado(estado)}`}>{estado}</span>;
}

export function EtiquetaPrioridad({ prioridad }: { prioridad: Prioridad }) {
  return <span className={`etiqueta-prioridad pri-${prioridad.toLowerCase()}`}>{nombrePrioridad(prioridad)}</span>;
}
