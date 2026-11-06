// Cálculos de indicadores a partir de las filas de v_backlog (ya filtradas por unidad)
// y de v_semanas_backlog. Los usan la pantalla Indicadores y el reporte semanal.
import { lunesDe, sumarDiasISO } from "./fmt";
import { ESTADOS_ABIERTOS, PRIORIDADES, type BacklogFila, type Prioridad, type SemanasBacklog } from "./types";

export const esAbierto = (b: BacklogFila) => ESTADOS_ABIERTOS.includes(b.estado);
const esCierre = (b: BacklogFila) => (b.estado === "Ejecutado" || b.estado === "Validado") && !!b.fecha_ejecucion;
const anulado = (b: BacklogFila) => b.estado === "Rechazado" || b.estado === "Anulado";

export interface Resumen {
  abiertos: number;
  hhPendientes: number;
  vencidos: number;
  sinHh: number;
  hhProgramadas: number;
  pctProgramado: number | null;
  cierres4: number;
  cierresEnPlazo4: number;
  pctEnPlazo: number | null;
}

export function resumen(filas: BacklogFila[], hoy: string): Resumen {
  const abiertos = filas.filter(esAbierto);
  const hhPendientes = abiertos.reduce((s, b) => s + Number(b.hh_estimadas), 0);
  const hhProgramadas = abiertos.filter((b) => b.estado === "Programado").reduce((s, b) => s + Number(b.hh_estimadas), 0);
  const desde = sumarDiasISO(lunesDe(hoy), -21); // cuatro semanas, incluida la actual
  const cierres = filas.filter((b) => esCierre(b) && b.fecha_ejecucion! >= desde);
  const enPlazo = cierres.filter((b) => b.fecha_limite && b.fecha_ejecucion! <= b.fecha_limite).length;
  return {
    abiertos: abiertos.length,
    hhPendientes,
    vencidos: abiertos.filter((b) => b.vencido).length,
    sinHh: abiertos.filter((b) => Number(b.hh_estimadas) === 0).length,
    hhProgramadas,
    pctProgramado: hhPendientes > 0 ? hhProgramadas / hhPendientes : null,
    cierres4: cierres.length,
    cierresEnPlazo4: enPlazo,
    pctEnPlazo: cierres.length ? enPlazo / cierres.length : null,
  };
}

export interface SemanasEspecialidad {
  especialidad: string;
  hhPendientes: number;
  hhSemana: number;
  semanas: number | null;
}

// Con varias unidades se suman HH y capacidades por especialidad antes de dividir.
export function semanasPorEspecialidad(filas: SemanasBacklog[]): { lista: SemanasEspecialidad[]; total: SemanasEspecialidad } {
  const m = new Map<string, SemanasEspecialidad>();
  for (const f of filas) {
    const x = m.get(f.especialidad) ?? { especialidad: f.especialidad, hhPendientes: 0, hhSemana: 0, semanas: null };
    x.hhPendientes += Number(f.hh_pendientes);
    x.hhSemana += Number(f.hh_semana ?? 0);
    m.set(f.especialidad, x);
  }
  const lista = [...m.values()]
    .map((x) => ({ ...x, semanas: x.hhSemana > 0 ? x.hhPendientes / x.hhSemana : null }))
    .filter((x) => x.hhPendientes > 0 || x.hhSemana > 0)
    .sort((a, b) => (b.semanas ?? Infinity) - (a.semanas ?? Infinity) || b.hhPendientes - a.hhPendientes);
  const conCapacidad = lista.filter((x) => x.hhSemana > 0);
  const hhP = conCapacidad.reduce((s, x) => s + x.hhPendientes, 0);
  const hhS = conCapacidad.reduce((s, x) => s + x.hhSemana, 0);
  return { lista, total: { especialidad: "Total", hhPendientes: hhP, hhSemana: hhS, semanas: hhS > 0 ? hhP / hhS : null } };
}

export const RANGOS_ANTIGUEDAD = [
  { etiqueta: "0-15 días", desde: 0, hasta: 15 },
  { etiqueta: "16-30 días", desde: 16, hasta: 30 },
  { etiqueta: "31-60 días", desde: 31, hasta: 60 },
  { etiqueta: "Más de 60 días", desde: 61, hasta: Infinity },
];

export function antiguedad(filas: BacklogFila[]) {
  const abiertos = filas.filter(esAbierto);
  return RANGOS_ANTIGUEDAD.map((r) => {
    const en = abiertos.filter((b) => b.antiguedad_dias >= r.desde && b.antiguedad_dias <= r.hasta);
    return { etiqueta: r.etiqueta, cantidad: en.length, hh: en.reduce((s, b) => s + Number(b.hh_estimadas), 0) };
  });
}

export function vencidosPorPrioridad(filas: BacklogFila[]): { prioridad: Prioridad; abiertos: number; vencidos: number }[] {
  const abiertos = filas.filter(esAbierto);
  return PRIORIDADES.map((p) => ({
    prioridad: p,
    abiertos: abiertos.filter((b) => b.prioridad === p).length,
    vencidos: abiertos.filter((b) => b.prioridad === p && b.vencido).length,
  }));
}

export interface Semana {
  lunes: string;
  ingresos: number;
  cierres: number;
  abiertosAlCierre: number;
}

// Ingresos (detectados), cierres (ejecutados) y backlog abierto al domingo de cada
// semana. Rechazados y anulados no cuentan: la base no guarda la fecha en que se anularon.
export function semanal(filas: BacklogFila[], hoy: string, semanas = 12): Semana[] {
  const validos = filas.filter((b) => !anulado(b));
  const ultimo = lunesDe(hoy);
  return Array.from({ length: semanas }, (_, i) => {
    const lunes = sumarDiasISO(ultimo, -7 * (semanas - 1 - i));
    const domingo = sumarDiasISO(lunes, 6);
    return {
      lunes,
      ingresos: validos.filter((b) => b.fecha_deteccion >= lunes && b.fecha_deteccion <= domingo).length,
      cierres: validos.filter((b) => esCierre(b) && b.fecha_ejecucion! >= lunes && b.fecha_ejecucion! <= domingo).length,
      abiertosAlCierre: validos.filter(
        (b) => b.fecha_deteccion <= domingo && (!b.fecha_ejecucion || b.fecha_ejecucion > domingo) && !(esCierre(b) && !b.fecha_ejecucion)
      ).length,
    };
  });
}
