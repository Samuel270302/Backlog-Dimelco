import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";
import { todo, usePorUnidad } from "./queries";
import type { EstadoPreventivo, Preventivo, PreventivoEvento, PreventivoMaterial } from "./types";

// Preventivos programados a mano (021). La base valida todo en cambiar_estado_preventivo().
export const usePreventivos = () =>
  useQuery({
    queryKey: ["v_preventivos"],
    queryFn: () => todo<Preventivo>("v_preventivos", "fecha_programada"),
    select: usePorUnidad<Preventivo>(),
  });

async function filas<T>(tabla: string, campo: string, valor: string, orden: string): Promise<T[]> {
  const { data, error } = await supabase().from(tabla).select("*").eq(campo, valor).order(orden);
  if (error) throw error;
  return data as T[];
}

export const usePreventivo = (id: string) =>
  useQuery({
    queryKey: ["v_preventivos", id],
    queryFn: async () => (await filas<Preventivo>("v_preventivos", "id", id, "id"))[0] ?? null,
  });

export const useMaterialesPreventivo = (id: string) =>
  useQuery({
    queryKey: ["preventivo_materiales", id],
    enabled: !!id,
    queryFn: () => filas<PreventivoMaterial>("preventivo_materiales", "preventivo_id", id, "item"),
  });

export const useEventosPreventivo = (id: string) =>
  useQuery({
    queryKey: ["preventivo_eventos", id],
    queryFn: () => filas<PreventivoEvento>("preventivo_eventos", "preventivo_id", id, "creado_en"),
  });

// Materiales de varios preventivos (Excel y paquetes), por tandas de ids.
export async function leerMaterialesPreventivos(ids: string[]): Promise<PreventivoMaterial[]> {
  const salida: PreventivoMaterial[] = [];
  for (let i = 0; i < ids.length; i += 80) {
    const { data, error } = await supabase().from("preventivo_materiales").select("*").in("preventivo_id", ids.slice(i, i + 80));
    if (error) throw error;
    salida.push(...(data as PreventivoMaterial[]));
  }
  return salida.sort((a, b) => a.preventivo_id.localeCompare(b.preventivo_id) || a.item - b.item);
}

export async function cambiarEstadoPreventivo(id: string, estado: EstadoPreventivo, datos: Record<string, unknown>) {
  const { error } = await supabase().rpc("cambiar_estado_preventivo", { p_id: id, p_estado: estado, p_datos: datos });
  if (error) throw new Error(error.message);
}

// Acciones sobre un preventivo según su estado y el rol. Ejecutado y Anulado quedan
// bloqueados para el capturador; solo el administrador los vuelve a Programado.
export type AccionPreventivo = "reprogramar" | "ejecutar" | "anular" | "revertir";
export function accionesPreventivo(estado: EstadoPreventivo, esAdmin: boolean, puedeCapturar: boolean): AccionPreventivo[] {
  if (estado === "Programado") return puedeCapturar ? ["ejecutar", "reprogramar", "anular"] : [];
  return esAdmin ? ["revertir"] : [];
}
export const ETIQUETA_ACCION: Record<AccionPreventivo, string> = {
  ejecutar: "Marcar ejecutado",
  reprogramar: "Reprogramar",
  anular: "Anular",
  revertir: "Volver a programado",
};
