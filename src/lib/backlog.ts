import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";
import type {
  BacklogEvento,
  BacklogFila,
  BacklogHh,
  BacklogRepuesto,
  Estado,
  Perfil,
} from "./types";

async function filas<T>(tabla: string, campo: string, valor: string, orden?: string): Promise<T[]> {
  let q = supabase().from(tabla).select("*").eq(campo, valor);
  if (orden) q = q.order(orden);
  const { data, error } = await q;
  if (error) throw error;
  return data as T[];
}

export const useBacklog = (id: string) =>
  useQuery({
    queryKey: ["v_backlog", id],
    queryFn: async () => (await filas<BacklogFila>("v_backlog", "id", id))[0] ?? null,
  });

export const useHhBacklog = (id: string) =>
  useQuery({ queryKey: ["backlog_hh", id], queryFn: () => filas<BacklogHh>("backlog_hh", "backlog_id", id, "creado_en") });

export const useRepuestosBacklog = (id: string) =>
  useQuery({
    queryKey: ["backlog_repuestos", id],
    queryFn: () => filas<BacklogRepuesto>("backlog_repuestos", "backlog_id", id, "creado_en"),
  });

export const useEventosBacklog = (id: string) =>
  useQuery({
    queryKey: ["backlog_eventos", id],
    queryFn: () => filas<BacklogEvento>("backlog_eventos", "backlog_id", id, "creado_en"),
  });

export const ESTADOS_FINALES: Estado[] = ["Cerrado", "Rechazado", "Anulado"];

// Datos que pide cada transición; la base vuelve a validar todo en cambiar_estado_backlog().
export type CampoTransicion = "prioridad" | "fecha_programada" | "ot_sap" | "aprovechar_pm" | "fecha_ejecucion" | "motivo";

export interface Transicion {
  destino: Estado;
  etiqueta: string;
  soloAdmin: boolean;
  campos: CampoTransicion[];
  peligro?: boolean;
}

export function transiciones(estado: Estado): Transicion[] {
  const anular: Transicion = { destino: "Anulado", etiqueta: "Anular", soloAdmin: true, campos: ["motivo"], peligro: true };
  switch (estado) {
    case "Identificado":
      return [
        { destino: "En planificación", etiqueta: "Aprobar y planificar", soloAdmin: true, campos: ["prioridad"] },
        { destino: "Rechazado", etiqueta: "Rechazar", soloAdmin: true, campos: ["motivo"], peligro: true },
        anular,
      ];
    case "En planificación":
      return [
        { destino: "Esperando repuestos", etiqueta: "Pasar a esperar repuestos", soloAdmin: true, campos: [] },
        { destino: "Listo para programar", etiqueta: "Listo para programar", soloAdmin: true, campos: [] },
        anular,
      ];
    case "Esperando repuestos":
      return [
        { destino: "Listo para programar", etiqueta: "Listo para programar", soloAdmin: true, campos: [] },
        { destino: "En planificación", etiqueta: "Volver a planificación", soloAdmin: true, campos: [] },
        anular,
      ];
    case "Listo para programar":
      return [
        { destino: "Programado", etiqueta: "Programar", soloAdmin: true, campos: ["fecha_programada", "ot_sap", "aprovechar_pm"] },
        { destino: "En planificación", etiqueta: "Volver a planificación", soloAdmin: true, campos: [] },
        anular,
      ];
    case "Programado":
      return [
        { destino: "Ejecutado", etiqueta: "Marcar ejecutado", soloAdmin: false, campos: ["fecha_ejecucion"] },
        { destino: "Programado", etiqueta: "Reprogramar", soloAdmin: true, campos: ["fecha_programada", "motivo"] },
        { destino: "Listo para programar", etiqueta: "Quitar del calendario", soloAdmin: true, campos: ["motivo"] },
        anular,
      ];
    case "Ejecutado":
      return [{ destino: "Cerrado", etiqueta: "Cerrar", soloAdmin: true, campos: [] }];
    default:
      return [];
  }
}

export async function cambiarEstado(id: string, estado: Estado, datos: Record<string, unknown>) {
  const { error } = await supabase().rpc("cambiar_estado_backlog", { p_id: id, p_estado: estado, p_datos: datos });
  if (error) throw new Error(error.message);
}

// Nombre del usuario para la bitácora.
export function nombreUsuario(perfiles: Perfil[] | undefined, id: string | null): string {
  if (!id) return "";
  return perfiles?.find((p) => p.user_id === id)?.nombre ?? "Usuario";
}

export function claseEstado(estado: Estado): string {
  return "est-" + estado.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, "-");
}

// Lunes de la semana ISO de una fecha YYYY-MM-DD.
export function lunesDe(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  const dia = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dia);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Repuestos y HH de varios backlogs en pocas consultas (por tandas de ids, para
// no pasar el largo máximo de la URL). Se usa en el Kanban y en la vista por equipo.
const TANDA = 80;

async function porIds<T>(tabla: string, ids: string[]): Promise<T[]> {
  const salida: T[] = [];
  for (let i = 0; i < ids.length; i += TANDA) {
    const { data, error } = await supabase().from(tabla).select("*").in("backlog_id", ids.slice(i, i + TANDA));
    if (error) throw error;
    salida.push(...(data as T[]));
  }
  return salida;
}

function agrupar<T extends { backlog_id: string }>(filas: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const f of filas) {
    const lista = m.get(f.backlog_id);
    if (lista) lista.push(f);
    else m.set(f.backlog_id, [f]);
  }
  return m;
}

export function useDetalleBacklogs(ids: string[]) {
  const clave = [...ids].sort().join(",");
  return useQuery({
    queryKey: ["detalle-backlogs", clave],
    enabled: ids.length > 0,
    queryFn: async () => {
      const [repuestos, hh] = await Promise.all([
        porIds<BacklogRepuesto>("backlog_repuestos", ids),
        porIds<BacklogHh>("backlog_hh", ids),
      ]);
      return { repuestos: agrupar(repuestos), hh: agrupar(hh) };
    },
  });
}
