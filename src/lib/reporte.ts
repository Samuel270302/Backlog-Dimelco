// Reporte semanal de backlog para la reunión de mantenimiento (PDF A4 horizontal).
// Mismos cálculos que la pantalla Indicadores (src/lib/indicadores.ts).
import logoDimelco from "../assets/logo-dimelco.png";
import { fFecha, fNum, sumarDiasISO } from "./fmt";
import { abrirVentanaImpresion, comoDataUrl, escribirParaImprimir } from "./formato";
import { etapaDe, type BacklogFila } from "./types";
import { antiguedad, esAbierto, resumen, semanal, vencidosPorPrioridad, type SemanasEspecialidad } from "./indicadores";

const esc = (v: unknown) =>
  String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)} %`);
const sem = (v: number | null) => (v === null ? "sin capacidad" : fNum(v, 2));

export interface DatosReporte {
  filas: BacklogFila[];
  semanas: { lista: SemanasEspecialidad[]; total: SemanasEspecialidad };
  unidad: string;
  hoy: string;
}

export function armarReporte(d: DatosReporte, logo: string): string {
  const r = resumen(d.filas, d.hoy);
  const ant = antiguedad(d.filas);
  const venc = vencidosPorPrioridad(d.filas);
  const sems = semanal(d.filas, d.hoy, 8);
  const maxSem = Math.max(1, ...d.semanas.lista.map((s) => s.semanas ?? 0));
  const en7 = sumarDiasISO(d.hoy, 7);
  const hace7 = sumarDiasISO(d.hoy, -7);

  const vencidos = d.filas
    .filter((b) => esAbierto(b) && b.vencido)
    .sort((a, b) => a.prioridad.localeCompare(b.prioridad) || (a.dias_para_limite ?? 0) - (b.dias_para_limite ?? 0));
  const programados = d.filas
    .filter((b) => b.estado === "Programado" && b.fecha_programada && b.fecha_programada >= d.hoy && b.fecha_programada <= en7)
    .sort((a, b) => a.fecha_programada!.localeCompare(b.fecha_programada!) || a.cod_interno.localeCompare(b.cod_interno));
  const ejecutados = d.filas
    .filter((b) => (b.estado === "Ejecutado" || b.estado === "Validado") && b.fecha_ejecucion && b.fecha_ejecucion > hace7 && b.fecha_ejecucion <= d.hoy)
    .sort((a, b) => a.fecha_ejecucion!.localeCompare(b.fecha_ejecucion!));

  const vacio = (n: number, texto: string) => `<tr><td colspan="${n}" class="gris">${texto}</td></tr>`;
  const kpi = (valor: string, etiqueta: string) => `<div class="kpi"><b>${valor}</b><span>${etiqueta}</span></div>`;

  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<title>Reporte semanal de backlog</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", Arial, sans-serif; font-size: 10.5px; color: #1c1c1c; margin: 0; }
  .hoja { padding: 12px 16px; }
  .enc { display: flex; align-items: center; gap: 16px; border-bottom: 3px solid #252525; padding-bottom: 6px; }
  .enc img { max-height: 40px; }
  .enc h1 { font-size: 16px; margin: 0; }
  .enc .sub { color: #555; }
  .kpis { display: flex; gap: 8px; margin: 10px 0; }
  .kpi { flex: 1; border: 1px solid #ccc; border-radius: 6px; padding: 6px 8px; }
  .kpi b { display: block; font-size: 17px; }
  .kpi span { color: #555; }
  .cols { display: grid; grid-template-columns: 1.2fr 1fr 1fr; gap: 12px; }
  h2 { font-size: 12px; margin: 12px 0 4px; background: #252525; color: #f5b301; padding: 3px 6px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #d0d0d0; padding: 3px 5px; text-align: left; vertical-align: top; }
  th { background: #efefef; }
  .n { text-align: right; }
  .gris { color: #777; }
  .barra { display: inline-block; height: 8px; background: #2a78d6; border-radius: 0 4px 4px 0; vertical-align: middle; }
  .rojo { color: #9c0006; font-weight: 600; }
  .pie { margin-top: 10px; color: #777; font-size: 9px; text-align: right; }
  tr { page-break-inside: avoid; }
  @media print { @page { size: A4 landscape; margin: 9mm; } .hoja { padding: 0; } }
</style></head><body><div class="hoja">
<div class="enc">
  ${logo ? `<img src="${logo}" alt="Dimelco">` : ""}
  <div><h1>Reporte semanal de backlog</h1>
  <div class="sub">${esc(d.unidad)} · semana del ${fFecha(sumarDiasISO(d.hoy, -((new Date(d.hoy + "T00:00:00").getDay() + 6) % 7)))} · generado el ${fFecha(d.hoy)}</div></div>
</div>

<div class="kpis">
  ${kpi(String(r.abiertos), "backlogs abiertos")}
  ${kpi(fNum(r.hhPendientes), "HH pendientes")}
  ${kpi(sem(d.semanas.total.semanas), "semanas de backlog")}
  ${kpi(`${r.vencidos}`, "vencidos")}
  ${kpi(pct(r.pctProgramado), "de las HH pendientes ya programadas")}
  ${kpi(pct(r.pctEnPlazo), `cerrados en plazo (4 semanas, ${r.cierres4} cierres)`)}
</div>

<div class="cols">
  <div>
    <h2>Semanas de backlog por especialidad</h2>
    <table><thead><tr><th>Especialidad</th><th class="n">HH pend.</th><th class="n">HH/semana</th><th class="n">Semanas</th><th style="width:30%"></th></tr></thead><tbody>
    ${
      d.semanas.lista
        .map(
          (s) => `<tr><td>${esc(s.especialidad)}</td><td class="n">${fNum(s.hhPendientes)}</td><td class="n">${s.hhSemana ? fNum(s.hhSemana) : "—"}</td>
          <td class="n">${sem(s.semanas)}</td><td>${s.semanas ? `<span class="barra" style="width:${(s.semanas / maxSem) * 100}%"></span>` : ""}</td></tr>`
        )
        .join("") || vacio(5, "Sin HH pendientes")
    }
    <tr><th>Total</th><th class="n">${fNum(d.semanas.total.hhPendientes)}</th><th class="n">${fNum(d.semanas.total.hhSemana)}</th><th class="n">${sem(d.semanas.total.semanas)}</th><th></th></tr>
    </tbody></table>
    ${r.sinHh ? `<p class="gris">${r.sinHh} backlog(s) abiertos sin HH estimadas no entran en el cálculo.</p>` : ""}
  </div>
  <div>
    <h2>Antigüedad de los abiertos</h2>
    <table><thead><tr><th>Rango</th><th class="n">Backlogs</th><th class="n">HH</th></tr></thead><tbody>
    ${ant.map((a) => `<tr><td>${a.etiqueta}</td><td class="n">${a.cantidad}</td><td class="n">${fNum(a.hh)}</td></tr>`).join("")}
    </tbody></table>
    <h2>Vencidos por prioridad</h2>
    <table><thead><tr><th>Prioridad</th><th class="n">Abiertos</th><th class="n">Vencidos</th></tr></thead><tbody>
    ${venc.map((v) => `<tr><td>${v.prioridad}</td><td class="n">${v.abiertos}</td><td class="n${v.vencidos ? " rojo" : ""}">${v.vencidos}</td></tr>`).join("")}
    </tbody></table>
  </div>
  <div>
    <h2>Ingresos y cierres (8 semanas)</h2>
    <table><thead><tr><th>Semana</th><th class="n">Ingresos</th><th class="n">Cierres</th><th class="n">Abiertos al cierre</th></tr></thead><tbody>
    ${sems.map((s) => `<tr><td>${fFecha(s.lunes)}</td><td class="n">${s.ingresos}</td><td class="n">${s.cierres}</td><td class="n">${s.abiertosAlCierre}</td></tr>`).join("")}
    </tbody></table>
  </div>
</div>

<h2>Vencidos (${vencidos.length})</h2>
<table><thead><tr><th>Folio</th><th>Equipo</th><th>Trabajo</th><th>Prioridad</th><th>Etapa</th><th>Fecha límite</th><th class="n">Días de atraso</th><th class="n">HH</th></tr></thead><tbody>
${
  vencidos
    .map(
      (b) => `<tr><td>${esc(b.folio)}</td><td>${esc(b.cod_interno)}</td><td>${esc(b.descripcion)}</td><td>${b.prioridad}${b.tipo_pedido === "Urgente" ? " · Urgente" : ""}</td>
      <td>${esc(etapaDe(b.estado))}${etapaDe(b.estado) !== b.estado ? ` (${esc(b.estado)})` : ""}</td><td>${fFecha(b.fecha_limite)}</td><td class="n rojo">${-(b.dias_para_limite ?? 0)}</td><td class="n">${fNum(b.hh_estimadas)}</td></tr>`
    )
    .join("") || vacio(8, "Sin vencidos")
}
</tbody></table>

<h2>Programados para los próximos 7 días (${programados.length})</h2>
<table><thead><tr><th>Fecha</th><th>Equipo</th><th>Folio</th><th>Trabajo</th><th>OT SAP</th><th class="n">HH</th><th>Con PM</th></tr></thead><tbody>
${
  programados
    .map(
      (b) => `<tr><td>${fFecha(b.fecha_programada)}</td><td>${esc(b.cod_interno)}</td><td>${esc(b.folio)}</td><td>${esc(b.descripcion)}</td>
      <td>${esc(b.ot_sap)}</td><td class="n">${fNum(b.hh_estimadas)}</td><td>${b.aprovechar_pm ? "Sí" : ""}</td></tr>`
    )
    .join("") || vacio(7, "Nada programado")
}
</tbody></table>

<h2>Ejecutados en los últimos 7 días (${ejecutados.length})</h2>
<table><thead><tr><th>Fecha</th><th>Equipo</th><th>Folio</th><th>Trabajo</th><th class="n">HH estimadas</th><th class="n">HH reales</th><th class="n">Diferencia</th><th>Estado</th></tr></thead><tbody>
${
  ejecutados
    .map((b) => {
      const dif = Number(b.hh_reales) - Number(b.hh_estimadas);
      return `<tr><td>${fFecha(b.fecha_ejecucion)}</td><td>${esc(b.cod_interno)}</td><td>${esc(b.folio)}</td><td>${esc(b.descripcion)}</td>
      <td class="n">${fNum(b.hh_estimadas)}</td><td class="n">${fNum(b.hh_reales)}</td><td class="n">${dif > 0 ? "+" : ""}${fNum(dif)}</td><td>${esc(b.estado)}</td></tr>`;
    })
    .join("") || vacio(8, "Nada ejecutado")
}
</tbody></table>
<div class="pie">Control de Backlog · Dimelco · ${esc(d.unidad)} · ${fFecha(d.hoy)}</div>
</div></body></html>`;
}

interface AppInfo {
  guardarPdf?: (html: string, nombre: string, vertical?: boolean) => Promise<string | null>;
}

export async function reporteSemanal(d: DatosReporte): Promise<string | null> {
  const ventana = abrirVentanaImpresion();
  try {
    const html = armarReporte(d, await comoDataUrl(logoDimelco));
    if (ventana) {
      escribirParaImprimir(ventana, html);
      return null;
    }
    const nombre = `Reporte semanal backlog ${d.unidad} ${d.hoy}.pdf`;
    return (window as unknown as { appInfo: Required<AppInfo> }).appInfo.guardarPdf(html, nombre);
  } catch (e) {
    ventana?.close();
    throw e;
  }
}
