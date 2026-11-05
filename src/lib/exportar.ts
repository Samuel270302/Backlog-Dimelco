import ExcelJS from "exceljs";
import type { BacklogFila } from "./types";
import { etapaDe } from "./types";
import { esAbierto, type SemanasEspecialidad } from "./indicadores";

interface AppEscritorio {
  guardarArchivo?: (datos: Uint8Array, nombre: string) => Promise<string | null>;
}

// Escritorio: diálogo de guardar de Electron. Navegador: descarga normal.
export async function descargar(buf: ArrayBuffer, nombre: string): Promise<string | null> {
  const escritorio = (window as unknown as { appInfo?: AppEscritorio }).appInfo;
  if (escritorio?.guardarArchivo) return escritorio.guardarArchivo(new Uint8Array(buf), nombre);
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nombre;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return null;
}

const fecha = (v: string | null) => (v ? new Date(v + "T00:00:00") : null);

function encabezado(hoja: ExcelJS.Worksheet) {
  const fila = hoja.getRow(1);
  fila.font = { bold: true, color: { argb: "FFF5B301" } };
  fila.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF252525" } };
  fila.alignment = { vertical: "middle", wrapText: true };
  fila.height = 30;
  hoja.views = [{ state: "frozen", ySplit: 1 }];
  hoja.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: hoja.columnCount } };
}

export async function exportarAbiertos(
  filas: BacklogFila[],
  semanas: SemanasEspecialidad[],
  unidades: Map<string, string>,
  titulo: string
): Promise<string | null> {
  const libro = new ExcelJS.Workbook();
  libro.creator = "Control de Backlog - Dimelco";
  const hoja = libro.addWorksheet("Backlogs abiertos");
  hoja.columns = [
    { header: "Folio", key: "folio", width: 15 },
    { header: "Unidad", key: "unidad", width: 13 },
    { header: "Código interno", key: "cod", width: 12 },
    { header: "Equipo", key: "flota", width: 12 },
    { header: "Marca", key: "marca", width: 11 },
    { header: "Modelo", key: "modelo", width: 12 },
    { header: "Sistema", key: "sistema", width: 18 },
    { header: "Componente", key: "componente", width: 20 },
    { header: "Descripción del trabajo", key: "descripcion", width: 45 },
    { header: "Tipo de pedido", key: "tipo", width: 10 },
    { header: "Prioridad", key: "prioridad", width: 9 },
    { header: "Etapa", key: "etapa", width: 12 },
    { header: "Estado", key: "estado", width: 20 },
    { header: "Detección", key: "deteccion", width: 11, style: { numFmt: "dd/mm/yyyy" } },
    { header: "Fecha límite", key: "limite", width: 11, style: { numFmt: "dd/mm/yyyy" } },
    { header: "Días", key: "dias", width: 7 },
    { header: "Vencido", key: "vencido", width: 8 },
    { header: "HH estimadas", key: "hh", width: 10 },
    { header: "Repuestos sin recibir", key: "rep_pend", width: 10 },
    { header: "Repuestos", key: "rep", width: 9 },
    { header: "OT SAP", key: "ot", width: 11 },
    { header: "Fecha programada", key: "programada", width: 11, style: { numFmt: "dd/mm/yyyy" } },
    { header: "Solicitado por", key: "solicitado", width: 18 },
  ];
  const abiertos = filas.filter(esAbierto).sort((a, b) => a.folio.localeCompare(b.folio));
  for (const b of abiertos) {
    const fila = hoja.addRow({
      folio: b.folio,
      unidad: unidades.get(b.unidad_id) ?? "",
      cod: b.cod_interno,
      flota: b.flota,
      marca: b.marca,
      modelo: b.modelo,
      sistema: b.sistema,
      componente: b.componente,
      descripcion: b.descripcion,
      tipo: b.tipo_pedido,
      prioridad: b.prioridad,
      etapa: etapaDe(b.estado),
      estado: b.estado,
      deteccion: fecha(b.fecha_deteccion),
      limite: fecha(b.fecha_limite),
      dias: b.antiguedad_dias,
      vencido: b.vencido ? "Sí" : "No",
      hh: Number(b.hh_estimadas),
      rep_pend: b.repuestos_pendientes,
      rep: b.repuestos_total,
      ot: b.ot_sap,
      programada: fecha(b.fecha_programada),
      solicitado: b.reportado_por,
    });
    if (b.vencido) fila.getCell("vencido").font = { bold: true, color: { argb: "FF9C0006" } };
  }
  encabezado(hoja);

  const hs = libro.addWorksheet("Semanas de backlog");
  hs.columns = [
    { header: "Especialidad", key: "esp", width: 18 },
    { header: "HH pendientes", key: "hh", width: 14 },
    { header: "HH por semana", key: "cap", width: 14 },
    { header: "Semanas de backlog", key: "sem", width: 16, style: { numFmt: "0.00" } },
  ];
  for (const s of semanas) hs.addRow({ esp: s.especialidad, hh: s.hhPendientes, cap: s.hhSemana || null, sem: s.semanas });
  encabezado(hs);

  const buf = await libro.xlsx.writeBuffer();
  return descargar(buf as ArrayBuffer, `${titulo}.xlsx`);
}
