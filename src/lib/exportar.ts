import type ExcelJS from "exceljs";
import type { BacklogFila, BacklogRepuesto } from "./types";
import { etapaDe, nombrePrioridad } from "./types";
import { esAbierto, type SemanasEspecialidad } from "./indicadores";
import { hoyISO, sumarDiasISO } from "./fmt";

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

// Cerrados de los últimos 7 días: ejecutados o validados con fecha de ejecución en
// (hoy - 7, hoy], el mismo período del reporte semanal.
export function cerradosUltimos7(filas: BacklogFila[], hoy: string): BacklogFila[] {
  const desde = sumarDiasISO(hoy, -7);
  return filas
    .filter((b) => (b.estado === "Ejecutado" || b.estado === "Validado") && b.fecha_ejecucion && b.fecha_ejecucion > desde && b.fecha_ejecucion <= hoy)
    .sort((a, b) => a.fecha_ejecucion!.localeCompare(b.fecha_ejecucion!) || a.folio.localeCompare(b.folio));
}

// Libro de backlog (abiertos, cerrados de 7 días y semanas de backlog). Sin navegador:
// lo usan la exportación de Indicadores y el reporte semanal por correo.
export async function armarLibroBacklog(
  filas: BacklogFila[],
  semanas: SemanasEspecialidad[],
  unidades: Map<string, string>,
  hoy: string,
  repuestos: BacklogRepuesto[] = []
): Promise<ArrayBuffer> {
  const { default: Excel } = await import("exceljs"); // se carga solo al exportar
  const libro = new Excel.Workbook();
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
    { header: "N° OT", key: "ot", width: 11 },
    { header: "Fecha programada", key: "programada", width: 11, style: { numFmt: "dd/mm/yyyy" } },
    { header: "Reportado por", key: "solicitado", width: 18 },
    { header: "Aprobado por", key: "aprobado", width: 18 },
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
      prioridad: nombrePrioridad(b.prioridad),
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
      aprobado: b.aprobado_por,
    });
    if (b.vencido) fila.getCell("vencido").font = { bold: true, color: { argb: "FF9C0006" } };
  }
  encabezado(hoja);

  // Repuestos con la actividad de su backlog: una fila por número de parte.
  const porBacklog = new Map<string, BacklogRepuesto[]>();
  for (const r of repuestos) porBacklog.set(r.backlog_id, [...(porBacklog.get(r.backlog_id) ?? []), r]);
  const hojaRepuestos = (nombre: string, lista: BacklogFila[], conEjecucion: boolean) => {
    const h = libro.addWorksheet(nombre);
    h.columns = [
      { header: "Folio", key: "folio", width: 15 },
      { header: "Unidad", key: "unidad", width: 13 },
      { header: "Código interno", key: "cod", width: 12 },
      { header: "Equipo", key: "flota", width: 16 },
      { header: "Actividad", key: "actividad", width: 45 },
      { header: "Sistema", key: "sistema", width: 18 },
      { header: "Estado del backlog", key: "estado", width: 18 },
      ...(conEjecucion
        ? [
            { header: "Ejecutado", key: "ejecucion", width: 11, style: { numFmt: "dd/mm/yyyy" } },
            { header: "N° OT", key: "ot", width: 11 },
          ]
        : []),
      { header: "Ítem", key: "item", width: 6 },
      { header: "Número de parte", key: "parte", width: 16 },
      { header: "Código SAP", key: "sap", width: 12 },
      { header: "Descripción del repuesto", key: "descripcion", width: 32 },
      { header: "Cant/Req", key: "cantidad", width: 9 },
      { header: "Stock", key: "stock", width: 8 },
      { header: "Componente", key: "componente", width: 20 },
      { header: "Observaciones", key: "obs", width: 24 },
      { header: "Solicitud (SolPed)", key: "solicitud", width: 14 },
      { header: "Estado del repuesto", key: "estado_rep", width: 12 },
      { header: "Fecha estimada", key: "estimada", width: 11, style: { numFmt: "dd/mm/yyyy" } },
      { header: "Recibido", key: "recibido", width: 11, style: { numFmt: "dd/mm/yyyy" } },
    ];
    for (const b of [...lista].sort((x, y) => x.folio.localeCompare(y.folio))) {
      for (const r of [...(porBacklog.get(b.id) ?? [])].sort((x, y) => x.item - y.item)) {
        h.addRow({
          folio: b.folio,
          unidad: unidades.get(b.unidad_id) ?? "",
          cod: b.cod_interno,
          flota: b.flota,
          actividad: b.descripcion,
          sistema: b.sistema,
          estado: b.estado,
          ejecucion: fecha(b.fecha_ejecucion),
          ot: b.ot_sap,
          item: r.item,
          parte: r.numero_parte,
          sap: r.cod_sap,
          descripcion: r.descripcion,
          cantidad: Number(r.cantidad),
          stock: r.stock === null ? null : Number(r.stock),
          componente: r.componente,
          obs: r.observaciones,
          solicitud: r.solicitud_sap,
          estado_rep: r.estado,
          estimada: fecha(r.fecha_estimada),
          recibido: fecha(r.fecha_recibido),
        });
      }
    }
    encabezado(h);
  };
  hojaRepuestos("Repuestos de abiertos", abiertos, false);

  const hc = libro.addWorksheet("Cerrados últimos 7 días");
  hc.columns = [
    { header: "Folio", key: "folio", width: 15 },
    { header: "Unidad", key: "unidad", width: 13 },
    { header: "Código interno", key: "cod", width: 12 },
    { header: "Descripción del trabajo", key: "descripcion", width: 45 },
    { header: "Sistema", key: "sistema", width: 18 },
    { header: "Ejecutado", key: "ejecucion", width: 11, style: { numFmt: "dd/mm/yyyy" } },
    { header: "Estado", key: "estado", width: 11 },
    { header: "Fecha límite", key: "limite", width: 11, style: { numFmt: "dd/mm/yyyy" } },
    { header: "En plazo", key: "plazo", width: 9 },
    { header: "HH estimadas", key: "hh_est", width: 10 },
    { header: "HH reales", key: "hh_real", width: 10 },
    { header: "Diferencia HH", key: "dif", width: 11 },
    { header: "N° OT", key: "ot", width: 11 },
  ];
  for (const b of cerradosUltimos7(filas, hoy)) {
    hc.addRow({
      folio: b.folio,
      unidad: unidades.get(b.unidad_id) ?? "",
      cod: b.cod_interno,
      descripcion: b.descripcion,
      sistema: b.sistema,
      ejecucion: fecha(b.fecha_ejecucion),
      estado: b.estado,
      limite: fecha(b.fecha_limite),
      plazo: b.fecha_limite && b.fecha_ejecucion! <= b.fecha_limite ? "Sí" : "No",
      hh_est: Number(b.hh_estimadas),
      hh_real: Number(b.hh_reales),
      dif: Number(b.hh_reales) - Number(b.hh_estimadas),
      ot: b.ot_sap,
    });
  }
  encabezado(hc);

  // Todos los ejecutados y validados, con sus repuestos (consumo histórico).
  const ejecutados = filas
    .filter((b) => b.estado === "Ejecutado" || b.estado === "Validado")
    .sort((a, b) => (b.fecha_ejecucion ?? "").localeCompare(a.fecha_ejecucion ?? "") || a.folio.localeCompare(b.folio));
  const he = libro.addWorksheet("Ejecutados y validados");
  he.columns = [
    { header: "Folio", key: "folio", width: 15 },
    { header: "Unidad", key: "unidad", width: 13 },
    { header: "Código interno", key: "cod", width: 12 },
    { header: "Equipo", key: "flota", width: 16 },
    { header: "Actividad", key: "actividad", width: 45 },
    { header: "Sistema", key: "sistema", width: 18 },
    { header: "Estado", key: "estado", width: 11 },
    { header: "Detección", key: "deteccion", width: 11, style: { numFmt: "dd/mm/yyyy" } },
    { header: "Ejecutado", key: "ejecucion", width: 11, style: { numFmt: "dd/mm/yyyy" } },
    { header: "En plazo", key: "plazo", width: 9 },
    { header: "HH estimadas", key: "hh_est", width: 10 },
    { header: "HH reales", key: "hh_real", width: 10 },
    { header: "Repuestos", key: "rep", width: 9 },
    { header: "N° OT", key: "ot", width: 11 },
  ];
  for (const b of ejecutados) {
    he.addRow({
      folio: b.folio,
      unidad: unidades.get(b.unidad_id) ?? "",
      cod: b.cod_interno,
      flota: b.flota,
      actividad: b.descripcion,
      sistema: b.sistema,
      estado: b.estado,
      deteccion: fecha(b.fecha_deteccion),
      ejecucion: fecha(b.fecha_ejecucion),
      plazo: b.fecha_limite && b.fecha_ejecucion && b.fecha_ejecucion <= b.fecha_limite ? "Sí" : "No",
      hh_est: Number(b.hh_estimadas),
      hh_real: Number(b.hh_reales),
      rep: b.repuestos_total,
      ot: b.ot_sap,
    });
  }
  encabezado(he);
  hojaRepuestos("Rep. ejecutados y validados", ejecutados, true);

  const hs = libro.addWorksheet("Semanas de backlog");
  hs.columns = [
    { header: "Especialidad", key: "esp", width: 18 },
    { header: "HH pendientes", key: "hh", width: 14 },
    { header: "HH por semana", key: "cap", width: 14 },
    { header: "Semanas de backlog", key: "sem", width: 16, style: { numFmt: "0.00" } },
  ];
  for (const s of semanas) hs.addRow({ esp: s.especialidad, hh: s.hhPendientes, cap: s.hhSemana || null, sem: s.semanas });
  encabezado(hs);

  return (await libro.xlsx.writeBuffer()) as ArrayBuffer;
}

export async function exportarAbiertos(
  filas: BacklogFila[],
  semanas: SemanasEspecialidad[],
  unidades: Map<string, string>,
  titulo: string,
  repuestos: BacklogRepuesto[] = []
): Promise<string | null> {
  return descargar(await armarLibroBacklog(filas, semanas, unidades, hoyISO(), repuestos), `${titulo}.xlsx`);
}
