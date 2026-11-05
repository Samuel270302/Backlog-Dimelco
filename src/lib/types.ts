export interface Unidad {
  id: string;
  nombre: string;
  sigla: string;
  activo: boolean;
  orden: number;
}

export interface Perfil {
  user_id: string;
  nombre: string;
  correo: string | null;
  rol: "admin" | "capturador" | "invitado";
  activo: boolean;
  unidad_id: string | null;
}

export interface Equipo {
  id: string;
  unidad_id: string;
  cod_interno: string;
  cod_sap: string | null;
  modelo: string;
  flota: string | null;
  marca: string | null;
  activo: boolean;
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
  "Cerrado",
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

export const PRIORIDADES = ["P1", "P2", "P3", "P4"] as const;
export type Prioridad = (typeof PRIORIDADES)[number];

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
  tipo: "estado" | "comentario" | "repuesto" | "reprogramación";
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
