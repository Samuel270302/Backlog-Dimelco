import type { EstadoPreventivo } from "../../lib/types";

export function EtiquetaEstadoPreventivo({ estado }: { estado: EstadoPreventivo }) {
  return <span className={`etiqueta-estado est-${estado.toLowerCase()}`}>{estado}</span>;
}
