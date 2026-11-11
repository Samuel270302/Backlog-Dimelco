import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";
import { supabase } from "./supabase";
import { reportarCanal } from "./conexion";
import { useUnidad } from "./unidad";
import type { BacklogFila, CapacidadTaller, Catalogo, Equipo, FamiliaSistema, Perfil, SemanasBacklog } from "./types";

export async function todo<T>(tabla: string, orden?: string): Promise<T[]> {
  let q = supabase().from(tabla).select("*");
  if (orden) q = q.order(orden);
  const { data, error } = await q;
  if (error) throw error;
  return data as T[];
}

// Filtro por unidad: capturador e invitado ya reciben solo su unidad desde la base;
// el admin elige una unidad en el menú y aquí se filtra lo ya descargado.
export function usePorUnidad<T extends { unidad_id?: string | null }>() {
  const { unidadId } = useUnidad();
  return useCallback((filas: T[]) => (unidadId ? filas.filter((f) => f.unidad_id === unidadId) : filas), [unidadId]);
}

export const usePerfiles = () =>
  useQuery({ queryKey: ["perfiles"], queryFn: () => todo<Perfil>("perfiles", "nombre") });

export const useEquipos = () =>
  useQuery({
    queryKey: ["equipos"],
    queryFn: () => todo<Equipo>("equipos", "cod_interno"),
    select: usePorUnidad<Equipo>(),
  });

export const useSistemas = () =>
  useQuery({ queryKey: ["sistemas"], queryFn: () => todo<Catalogo>("sistemas", "orden") });

export const useFamilias = () =>
  useQuery({ queryKey: ["familias"], queryFn: () => todo<Catalogo>("familias", "orden") });

export const useFamiliaSistemas = () =>
  useQuery({ queryKey: ["familia_sistemas"], queryFn: () => todo<FamiliaSistema>("familia_sistemas") });

// Sistemas que se ofrecen para un equipo: los de su familia más "Otro". Si el equipo
// no tiene familia o su familia aún no tiene sistemas cargados, todos los activos.
export function sistemasDeEquipo(
  equipo: { familia_id: string | null } | undefined,
  sistemas: Catalogo[] | undefined,
  relaciones: FamiliaSistema[] | undefined,
  incluir?: string
): Catalogo[] {
  const activos = (sistemas ?? []).filter((s) => s.activo || s.id === incluir);
  const deFamilia = new Set((relaciones ?? []).filter((r) => r.familia_id === equipo?.familia_id).map((r) => r.sistema_id));
  if (!equipo?.familia_id || deFamilia.size === 0) return activos;
  return activos.filter((s) => deFamilia.has(s.id) || s.nombre === "Otro" || s.id === incluir);
}

export const esOtro = (sistemas: Catalogo[] | undefined, id: string) => sistemas?.find((s) => s.id === id)?.nombre === "Otro";

export const useEspecialidades = () =>
  useQuery({ queryKey: ["especialidades"], queryFn: () => todo<Catalogo>("especialidades", "orden") });

export const useBacklogs = () =>
  useQuery({
    queryKey: ["v_backlog"],
    queryFn: () => todo<BacklogFila>("v_backlog", "fecha_deteccion"),
    select: usePorUnidad<BacklogFila>(),
  });

// Capacidad del taller: historial completo y la vigente a hoy() por unidad y especialidad.
export const useCapacidad = () =>
  useQuery({
    queryKey: ["capacidad_taller"],
    queryFn: () => todo<CapacidadTaller>("capacidad_taller", "vigente_desde"),
    select: usePorUnidad<CapacidadTaller>(),
  });

export const useCapacidadVigente = () =>
  useQuery({
    queryKey: ["v_capacidad_vigente"],
    queryFn: () => todo<CapacidadTaller>("v_capacidad_vigente"),
    select: usePorUnidad<CapacidadTaller>(),
  });

export const useSemanasBacklog = () =>
  useQuery({
    queryKey: ["v_semanas_backlog"],
    queryFn: () => todo<SemanasBacklog>("v_semanas_backlog"),
    select: usePorUnidad<SemanasBacklog>(),
  });

// Tablas cuyo cambio recarga las consultas abiertas (tiempo real de Supabase).
const TABLAS = [
  "backlogs",
  "backlog_hh",
  "backlog_repuestos",
  "backlog_eventos",
  "backlog_fotos",
  "preventivos",
  "preventivo_materiales",
  "preventivo_eventos",
  "paquetes",
  "equipos",
  "sistemas",
  "familias",
  "familia_sistemas",
  "especialidades",
  "capacidad_taller",
  "parametros",
  "perfiles",
];
const ESPERA_RECARGA_MS = 1500;

export function useTiempoReal() {
  const qc = useQueryClient();
  useEffect(() => {
    let temporizador: ReturnType<typeof setTimeout> | null = null;
    const canal = supabase()
      .channel("cambios-db")
      .on("postgres_changes", { event: "*", schema: "public" }, (payload) => {
        if (!TABLAS.includes(payload.table)) return;
        if (temporizador) clearTimeout(temporizador);
        temporizador = setTimeout(() => {
          temporizador = null;
          qc.invalidateQueries();
        }, ESPERA_RECARGA_MS);
      })
      .subscribe((estado) => reportarCanal(estado));
    return () => {
      if (temporizador) clearTimeout(temporizador);
      void supabase().removeChannel(canal);
    };
  }, [qc]);
}
