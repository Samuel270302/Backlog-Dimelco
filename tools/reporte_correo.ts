// Reporte semanal de backlog por correo. Lo corre GitHub Actions cada lunes
// (.github/workflows/reporte_semanal.yml): lee la base, arma el PDF del reporte semanal
// y el Excel de abiertos y cerrados con el mismo código de la app, y los envía por Gmail.
//
// Variables de entorno:
//   SUPABASE_DB_URL        cadena de conexión (o PGHOST/PGPORT/... para pruebas locales)
//   CORREO_REPORTE         cuenta de Gmail que envía
//   CORREO_CLAVE_APP       contraseña de aplicación de esa cuenta
//   CORREO_DESTINATARIOS   correos separados por comas
// Opciones:
//   --salida <carpeta>     deja el PDF, el Excel y el cuerpo del correo en la carpeta
//   --sin-enviar           arma el mensaje sin enviarlo e imprime un resumen (pruebas)
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import nodemailer from "nodemailer";
import { chromium } from "playwright";
import logoDimelco from "../src/assets/logo-dimelco.png";
import { armarReporte } from "../src/lib/reporte";
import { armarLibroBacklog, cerradosUltimos7 } from "../src/lib/exportar";
import { esAbierto, resumen, semanasPorEspecialidad } from "../src/lib/indicadores";
import { fFecha, fNum, lunesDe } from "../src/lib/fmt";
import type { BacklogFila, SemanasBacklog } from "../src/lib/types";

// Mismos formatos que entrega PostgREST a la app: fechas y marcas de tiempo como texto,
// numeric y bigint como número.
pg.types.setTypeParser(1082, (v: string) => v);
pg.types.setTypeParser(1184, (v: string) => new Date(v).toISOString());
pg.types.setTypeParser(1114, (v: string) => v);
pg.types.setTypeParser(1700, (v: string) => Number(v));
pg.types.setTypeParser(20, (v: string) => Number(v));

const args = process.argv.slice(2);
const opcion = (nombre: string) => {
  const i = args.indexOf(nombre);
  return i === -1 ? null : (args[i + 1] ?? "");
};
const salida = opcion("--salida");
const sinEnviar = args.includes("--sin-enviar");

const esc = (v: unknown) =>
  String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)} %`);
const sem = (v: number | null) => (v === null ? "sin capacidad" : fNum(v, 2));

function hoyNicaragua(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Managua" });
}

async function leerBase() {
  const cliente = new pg.Client(process.env.SUPABASE_DB_URL ? { connectionString: process.env.SUPABASE_DB_URL } : {});
  await cliente.connect();
  try {
    const filas = (await cliente.query("select * from v_backlog")).rows as BacklogFila[];
    const semanas = (await cliente.query("select * from v_semanas_backlog")).rows as SemanasBacklog[];
    const unidades = (await cliente.query("select id, nombre from unidades where activo order by orden")).rows as { id: string; nombre: string }[];
    return { filas, semanas, unidades };
  } finally {
    await cliente.end();
  }
}

function cuerpoCorreo(filas: BacklogFila[], semanas: SemanasBacklog[], unidades: { id: string; nombre: string }[], hoy: string) {
  const fila = (nombre: string, f: BacklogFila[], s: SemanasBacklog[], negrita = false) => {
    const r = resumen(f, hoy);
    const total = semanasPorEspecialidad(s).total;
    const td = (v: string, alinear = "right") =>
      `<td style="border:1px solid #d0d0d0;padding:5px 8px;text-align:${alinear};${negrita ? "font-weight:700;background:#f4f4f4;" : ""}">${v}</td>`;
    return `<tr>${td(esc(nombre), "left")}${td(String(r.abiertos))}${td(fNum(r.hhPendientes))}${td(sem(total.semanas))}${td(String(r.vencidos))}${td(pct(r.pctProgramado))}${td(String(cerradosUltimos7(f, hoy).length))}</tr>`;
  };
  const r = resumen(filas, hoy);
  const totalSem = semanasPorEspecialidad(semanas).total;
  const conDatos = unidades.filter((u) => filas.some((b) => b.unidad_id === u.id) || semanas.some((s) => s.unidad_id === u.id));
  const th = (t: string) => `<th style="border:1px solid #d0d0d0;padding:5px 8px;background:#252525;color:#f5b301;text-align:left">${t}</th>`;
  const cifra = (valor: string, etiqueta: string) =>
    `<td style="padding:8px 14px 8px 0;vertical-align:top"><div style="font-size:22px;font-weight:700;color:#1c1c1c">${valor}</div><div style="color:#555;font-size:12px">${etiqueta}</div></td>`;
  const vencidos = filas.filter((b) => esAbierto(b) && b.vencido).length;
  return `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#1c1c1c">
<p>Reporte semanal de backlog, semana del ${fFecha(lunesDe(hoy))}. Adjuntos: el reporte en PDF y el Excel con los backlogs abiertos, los cerrados de los últimos 7 días y las semanas de backlog.</p>
<table style="border-collapse:collapse;margin:6px 0 14px"><tr>
${cifra(String(r.abiertos), "backlogs abiertos")}
${cifra(fNum(r.hhPendientes), "HH acumuladas pendientes")}
${cifra(sem(totalSem.semanas), "semanas de backlog")}
${cifra(String(vencidos), "vencidos")}
${cifra(pct(r.pctProgramado), "HH ya programadas")}
${cifra(pct(r.pctEnPlazo), `cerrados en plazo (4 semanas, ${r.cierres4})`)}
</tr></table>
<table style="border-collapse:collapse;font-size:13px">
<tr>${th("Unidad")}${th("Abiertos")}${th("HH acumuladas")}${th("Semanas de backlog")}${th("Vencidos")}${th("HH programadas")}${th("Cerrados 7 días")}</tr>
${conDatos.map((u) => fila(u.nombre, filas.filter((b) => b.unidad_id === u.id), semanas.filter((s) => s.unidad_id === u.id))).join("\n")}
${fila("Todas las unidades", filas, semanas, true)}
</table>
<p style="color:#777;font-size:12px">Enviado automáticamente por Control de Backlog · Dimelco. Semanas de backlog = HH estimadas pendientes / HH disponibles por semana del taller.</p>
</div>`;
}

async function pdfDesdeHtml(html: string): Promise<Buffer> {
  const navegador = await chromium.launch();
  try {
    const pagina = await navegador.newPage();
    await pagina.setContent(html, { waitUntil: "load" });
    return await pagina.pdf({ format: "A4", landscape: true, printBackground: true, margin: { top: "9mm", bottom: "9mm", left: "9mm", right: "9mm" } });
  } finally {
    await navegador.close();
  }
}

async function main() {
  const hoy = hoyNicaragua();
  const { filas, semanas, unidades } = await leerBase();
  const semanasTodas = semanasPorEspecialidad(semanas);
  const html = armarReporte({ filas, semanas: semanasTodas, unidad: "Todas las unidades", hoy }, logoDimelco);
  const pdf = await pdfDesdeHtml(html);
  const xlsx = Buffer.from(await armarLibroBacklog(filas, semanasTodas.lista, new Map(unidades.map((u) => [u.id, u.nombre])), hoy));
  const cuerpo = cuerpoCorreo(filas, semanas, unidades, hoy);
  const asunto = `Reporte semanal de backlog · semana del ${fFecha(lunesDe(hoy))}`;
  const adjuntos = [
    { filename: `Reporte semanal backlog ${hoy}.pdf`, content: pdf, contentType: "application/pdf" },
    { filename: `Backlog abiertos y cerrados ${hoy}.xlsx`, content: xlsx, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  ];

  if (salida) {
    mkdirSync(salida, { recursive: true });
    for (const a of adjuntos) writeFileSync(join(salida, a.filename), a.content);
    writeFileSync(join(salida, "correo.html"), `<!doctype html><meta charset="utf-8"><title>${esc(asunto)}</title>${cuerpo}`);
  }

  const de = process.env.CORREO_REPORTE ?? "";
  const para = (process.env.CORREO_DESTINATARIOS ?? "").split(/[,;\s]+/).filter(Boolean);
  if (!sinEnviar && (!de || !process.env.CORREO_CLAVE_APP || !para.length))
    throw new Error("Faltan CORREO_REPORTE, CORREO_CLAVE_APP o CORREO_DESTINATARIOS");
  const transporte = sinEnviar
    ? nodemailer.createTransport({ jsonTransport: true })
    : nodemailer.createTransport({ service: "gmail", auth: { user: de, pass: process.env.CORREO_CLAVE_APP } });
  const info = await transporte.sendMail({
    from: { name: "Control de Backlog", address: de || "reporte@prueba.local" },
    to: para.length ? para : ["destino@prueba.local"],
    subject: asunto,
    html: cuerpo,
    attachments: adjuntos,
  });
  console.log(
    JSON.stringify({
      enviado: !sinEnviar,
      asunto,
      para: para.length,
      adjuntos: adjuntos.map((a) => ({ nombre: a.filename, bytes: a.content.length })),
      abiertos: filas.filter(esAbierto).length,
      idMensaje: info.messageId,
    })
  );
}

main().catch((e) => {
  console.error(`Reporte semanal: ${e.message}`);
  process.exit(1);
});
