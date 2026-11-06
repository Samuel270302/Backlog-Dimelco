export interface Unidad {
  id: string;
  nombre: string;
  sigla: string;
  activo: boolean;
  orden: number;
  usa_sap: boolean;
}

export interface Perfil {
  user_id: string;
  nombre: string;
  correo: string | null;
  rol: "admin" | "capturador" | "invitado";
  activo: boolean;
  unidad_id: string | null;
  unidades: string[];
}

export interface Equipo {
  id: string;
  unidad_id: string;
  cod_interno: string;
  cod_sap: string | null;
  modelo: string;
  flota: string | null;
  marca: string | null;
  familia_id: string | null;
  activo: boolean;
}

export interface FamiliaSistema {
  familia_id: string;
  sistema_id: string;
}

export interface Catalogo {
  id: string;
  nombre: string;
  activo: boolean;
  orden: number;
}

export interface CapacidadTaller {
  id: string;
  unidad_id: string;
  especialidad_id: string;
  hh_semana: number;
  vigente_desde: string;
}

export const ESTADOS = [
  "Identificado",
  "En planificación",
  "Esperando repuestos",
  "Listo para programar",
  "Programado",
  "Ejecutado",
  "Validado",
  "Rechazado",
  "Anulado",
] as const;
export type Estado = (typeof ESTADOS)[number];
export const ESTADOS_ABIERTOS: Estado[] = [
  "Identificado",
  "En planificación",
  "Esperando repuestos",
  "Listo para programar",
  "Programado",
];

// Etapas visibles del flujo (Kanban y barra de avance). «Planeado» agrupa los tres
// pasos de planificación que la base sigue distinguiendo.
export const ETAPAS = ["Identificado", "Planeado", "Programado", "Ejecutado", "Validado"] as const;
export type Etapa = (typeof ETAPAS)[number];
export const ESTADOS_PLANEADO: Estado[] = ["En planificación", "Esperando repuestos", "Listo para programar"];

export function etapaDe(estado: Estado): Etapa | null {
  if (estado === "Rechazado" || estado === "Anulado") return null;
  if (ESTADOS_PLANEADO.includes(estado)) return "Planeado";
  return estado as Etapa;
}

export const PRIORIDADES = ["P1", "P2", "P3", "P4"] as const;
export type Prioridad = (typeof PRIORIDADES)[number];
// Niveles de criticidad de la OT de Dimelco. La base guarda P1 a P4; el plazo en días
// está en parametros (1, 3, 14 y 40).
export const NOMBRE_PRIORIDAD: Record<Prioridad, string> = {
  P1: "1 Urgente",
  P2: "2 Alto",
  P3: "3 Medio",
  P4: "4 Bajo",
};
export const nombrePrioridad = (p: Prioridad) => NOMBRE_PRIORIDAD[p] ?? p;

export const TIPOS_PEDIDO = ["Normal", "Urgente"] as const;
export type TipoPedido = (typeof TIPOS_PEDIDO)[number];

export const ORIGENES = ["Inspección", "PM", "Operador", "Falla", "Análisis de aceite", "Otro"] as const;
export type Origen = (typeof ORIGENES)[number];

export interface Backlog {
  id: string;
  folio: string;
  unidad_id: string;
  equipo_id: string;
  sistema_id: string;
  sistema_otro: string | null;
  descripcion: string;
  justificacion: string | null;
  componente: string | null;
  horometro: number | null;
  tipo_pedido: TipoPedido;
  origen: Origen;
  prioridad: Prioridad;
  estado: Estado;
  fecha_deteccion: string;
  fecha_limite: string | null;
  reportado_por: string | null;
  aprobado_por: string | null;
  aviso_sap: string | null;
  ot_sap: string | null;
  semana_programada: string | null;
  fecha_programada: string | null;
  aprovechar_pm: boolean;
  fecha_ejecucion: string | null;
  reprogramaciones: number;
  motivo_anulacion: string | null;
  creado_por: string | null;
  creado_en: string;
  actualizado_en: string;
}

// Fila de v_backlog: el backlog con los datos derivados que usa el tablero.
export interface BacklogFila extends Backlog {
  cod_interno: string;
  modelo: string;
  marca: string | null;
  flota: string | null;
  sistema: string;
  antiguedad_dias: number;
  dias_para_limite: number | null;
  vencido: boolean;
  hh_estimadas: number;
  hh_reales: number;
  repuestos_total: number;
  repuestos_pendientes: number;
  familia_id: string | null;
  usa_sap: boolean;
}

export interface BacklogHh {
  id: string;
  backlog_id: string;
  especialidad_id: string;
  tipo: "estimada" | "real";
  personas: number;
  horas: number;
  hh: number;
}

export type EstadoRepuesto = "Por pedir" | "Pedido" | "Recibido";

export interface BacklogRepuesto {
  id: string;
  backlog_id: string;
  item: number;
  numero_parte: string | null;
  cod_sap: string | null;
  descripcion: string | null;
  cantidad: number;
  stock: number | null;
  componente: string | null;
  observaciones: string | null;
  um: string;
  solicitud_sap: string | null;
  estado: EstadoRepuesto;
  fecha_estimada: string | null;
  fecha_recibido: string | null;
}

export interface BacklogEvento {
  id: string;
  backlog_id: string;
  tipo: "estado" | "comentario" | "repuesto" | "reprogramación" | "borrado" | "restaurado";
  estado_anterior: Estado | null;
  estado_nuevo: Estado | null;
  texto: string | null;
  usuario: string | null;
  creado_en: string;
}

export interface BacklogFoto {
  id: string;
  backlog_id: string;
  repuesto_id: string | null;
  ruta: string;
  creado_por: string | null;
  creado_en: string;
}

export interface SemanasBacklog {
  unidad_id: string;
  especialidad_id: string;
  especialidad: string;
  hh_pendientes: number;
  hh_semana: number | null;
  semanas: number | null;
}
