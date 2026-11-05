import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth";
import { cambiarEstado, transiciones, type Transicion } from "../lib/backlog";
import type { BacklogFila, Estado } from "../lib/types";
import { useAvisos } from "./Avisos";
import DialogoTransicion from "./DialogoTransicion";

// Transiciones que el usuario actual puede hacer sobre un backlog.
export function useTransicionesPermitidas() {
  const { esAdmin, puedeCapturar } = useAuth();
  return (estado: Estado) => transiciones(estado).filter((t) => esAdmin || (puedeCapturar && !t.soloAdmin));
}

// Diálogo de cambio de estado compartido por la ficha y el Kanban.
export function useCambioEstado() {
  const qc = useQueryClient();
  const { avisar } = useAvisos();
  const [pendiente, setPendiente] = useState<{ b: BacklogFila; t: Transicion } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function aplicar(datos: Record<string, unknown>) {
    if (!pendiente) return;
    const { b, t } = pendiente;
    setOcupado(true);
    try {
      await cambiarEstado(b.id, t.destino, datos);
      avisar(`${b.folio}: ${t.destino}`);
      setPendiente(null);
      qc.invalidateQueries();
    } catch (e) {
      avisar((e as Error).message, "error");
    } finally {
      setOcupado(false);
    }
  }

  const dialogo = pendiente ? (
    <DialogoTransicion
      folio={pendiente.b.folio}
      transicion={pendiente.t}
      prioridadActual={pendiente.b.prioridad}
      otActual={pendiente.b.ot_sap}
      ocupado={ocupado}
      onAceptar={aplicar}
      onCerrar={() => setPendiente(null)}
    />
  ) : null;

  return { abrir: (b: BacklogFila, t: Transicion) => setPendiente({ b, t }), dialogo };
}
