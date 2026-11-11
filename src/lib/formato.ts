// Formato imprimible "Mantenimiento correctivo programado" de un backlog, con la
// disposición del formato en papel: encabezado, equipo, repuestos, HH, justificación
// y firmas. Lleva el logo Dimelco y, en las unidades de LOGOS_UNIDAD, también el de la
// unidad a la par (Explotec).
import logoDimelco from "../assets/logo-dimelco.png";
import logoExplotec from "../assets/logo-explotec.png";
import { fFecha, fNum } from "./fmt";
import type { BacklogEvento, BacklogFila, BacklogHh, BacklogRepuesto, Catalogo, Perfil } from "./types";
import { nombrePrioridad } from "./types";
import type { FotoConUrl } from "./fotos";

const FILAS_MINIMAS_REPUESTOS = 8;

// Logo que va a la par del de Dimelco, por nombre de unidad.
const LOGOS_UNIDAD: Record<string, string> = { Explotec: logoExplotec };

// Usuarios con correo de estos dominios imprimen solo con el logo de su empresa, sin
// Dimelco (pedido del 11/11/2026 para @explotec.com).
const MARCAS_DOMINIO: Record<string, { logo: string; nombre: string }> = {
  "explotec.com": { logo: logoExplotec, nombre: "Explotec" },
};
const MARCA_BASE = "Dimelco";

function marcaDeCorreo(correo: string | null | undefined) {
  const dominio = (correo ?? "").trim().toLowerCase().split("@")[1];
  return dominio ? MARCAS_DOMINIO[dominio] : undefined;
}

export const celdaLogos = (logo: string, logoUnidad: string, unidad: string, marca = MARCA_BASE) =>
  `<td class="logo${logoUnidad ? " doble" : ""}">${logo ? `<img src="${logo}" alt="${esc(marca)}">` : esc(marca)}${
    logoUnidad ? `<img src="${logoUnidad}" alt="${esc(unidad)}">` : ""
  }</td>`;

export const esc = (v: unknown) =>
  String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

// El PDF se arma en una ventana sin acceso a los archivos de la app: el logo va incrustado.
export async function comoDataUrl(url: string): Promise<string> {
  try {
    const blob = await (await fetch(url)).blob();
    return await new Promise((ok, mal) => {
      const r = new FileReader();
      r.onload = () => ok(String(r.result));
      r.onerror = mal;
      r.readAsDataURL(blob);
    });
  } catch {
    return "";
  }
}

export interface DatosFormato {
  b: BacklogFila;
  repuestos: BacklogRepuesto[];
  hh: BacklogHh[];
  especialidades: Catalogo[];
  eventos: BacklogEvento[];
  perfiles: Perfil[];
  unidad: string;
  fotos?: FotoConUrl[];
  // Correo de quien imprime: si es de un dominio de MARCAS_DOMINIO, el impreso sale solo con su logo.
  correoImprime?: string | null;
}

// Estilos comunes a todo lo que se imprime en A4 vertical: formato del backlog, OT de
// preventivo y paquete de órdenes.
const ESTILOS = `  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", Arial, sans-serif; font-size: 11px; color: #1c1c1c; margin: 0; }
  .hoja { padding: 14px 18px; }
  table { border-collapse: collapse; width: 100%; }
  td, th { border: 1px solid #555; padding: 4px 6px; vertical-align: top; text-align: left; }
  th { background: #e9e9e9; font-weight: 600; }
  .n { text-align: right; }
  .enc td { vertical-align: middle; }
  .enc .logo { width: 150px; text-align: center; }
  .enc .logo img { max-width: 130px; max-height: 52px; vertical-align: middle; }
  .enc .logo.doble { width: 270px; white-space: nowrap; }
  .enc .logo.doble img { max-width: 118px; margin: 0 4px; }
  .enc .titulo { font-size: 16px; font-weight: 700; text-align: center; letter-spacing: 0.5px; }
  .enc .datos { width: 190px; font-size: 11px; }
  .et { color: #555; font-size: 10px; display: block; }
  .bloque { margin-top: 8px; }
  .seccion { background: #252525; color: #f5b301; font-weight: 700; padding: 4px 6px; margin-top: 8px; }
  .vacia td { height: 20px; }
  .total td { font-weight: 700; background: #f4f4f4; }
  .gris { color: #777; }
  .texto { min-height: 60px; white-space: pre-wrap; }
  .firmas { display: flex; gap: 40px; margin-top: 46px; }
  .firma { flex: 1; text-align: center; }
  .firma .linea { border-top: 1px solid #1c1c1c; padding-top: 4px; font-weight: 600; }
  .firma .quien { min-height: 14px; margin-bottom: 2px; }
  .pie { margin-top: 14px; color: #777; font-size: 9px; text-align: right; }
  .hoja2 { page-break-before: always; padding-top: 6px; }
  .imagenes { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 8px; }
  .imagen { border: 1px solid #555; page-break-inside: avoid; }
  .imagen .datos { background: #e9e9e9; padding: 4px 6px; font-size: 10.5px; }
  .imagen img { display: block; width: 100%; max-height: 300px; object-fit: contain; background: #fff; }
  @media print { @page { size: A4 portrait; margin: 10mm; } .hoja { padding: 0; } }
  .salto { page-break-before: always; padding-top: 6px; }
  .casillas td { height: 26px; }
  .aviso-adjuntos { margin-top: 8px; border: 1px solid #555; padding: 6px 8px; font-weight: 600; }
  .caratula-dato { font-size: 13px; }
  .caja-alta td { height: 64px; }
`;

// Documento A4 con uno o varios cuerpos; cada cuerpo después del primero empieza hoja.
export function documentoImprimible(titulo: string, ...cuerpos: string[]): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<title>${esc(titulo)}</title>
<style>
${ESTILOS}</style></head><body>${cuerpos
    .map((c, i) => `<div class="hoja${i > 0 ? " salto" : ""}">\n${c}\n</div>`)
    .join("\n")}</body></html>`;
}

// Cuerpo del formato de un backlog. imagenes: id de foto -> data URL ya incrustable.
export function cuerpoFormato(
  d: DatosFormato,
  logo: string,
  imagenes: Map<string, string> = new Map(),
  logoUnidad = "",
  marca = MARCA_BASE
): string {
  const { b } = d;
  const nombre = (id: string | null) => d.perfiles.find((p) => p.user_id === id)?.nombre ?? "";
  const sap = b.usa_sap;
  const casilla = (si: boolean) => (si ? "&#9746;" : "&#9744;");

  const repuestos = [...d.repuestos].sort((a, b2) => a.item - b2.item);
  const filasRep = repuestos.map(
    (r) => `<tr>
      <td class="n">${r.item}</td><td>${esc(r.numero_parte)}</td>${sap ? `<td>${esc(r.cod_sap)}</td>` : ""}
      <td class="n">${fNum(r.cantidad, 2)}</td><td class="n">${fNum(r.stock, 2)}</td>
      <td>${esc(r.descripcion)}</td><td>${esc(r.componente)}</td><td>${esc(r.observaciones)}</td></tr>`
  );
  for (let i = repuestos.length; i < FILAS_MINIMAS_REPUESTOS; i++) {
    filasRep.push(`<tr class="vacia"><td class="n">${i + 1}</td>${"<td></td>".repeat(sap ? 7 : 6)}</tr>`);
  }

  const estimadas = d.hh.filter((h) => h.tipo === "estimada");
  const nombreEsp = (id: string) => d.especialidades.find((e) => e.id === id)?.nombre ?? "";
  const totalHh = estimadas.reduce((s, h) => s + Number(h.hh), 0);
  const filasHh = estimadas.length
    ? estimadas
        .map((h) => `<tr><td>${esc(nombreEsp(h.especialidad_id))}</td><td class="n">${fNum(h.personas)}</td><td class="n">${fNum(h.horas)}</td><td class="n">${fNum(h.hh)}</td></tr>`)
        .join("") + `<tr class="total"><td colspan="3">Total</td><td class="n">${fNum(totalHh)}</td></tr>`
    : `<tr><td colspan="4" class="gris">Sin HH estimadas</td></tr>`;

  return `<table class="enc"><tr>
  ${celdaLogos(logo, logoUnidad, d.unidad, marca)}
  <td class="titulo">MANTENIMIENTO CORRECTIVO PROGRAMADO</td>
  <td class="datos"><span class="et">N°</span><b>${esc(b.folio)}</b><br><span class="et">Fecha</span>${fFecha(b.fecha_deteccion)}<br><span class="et">Unidad</span>${esc(d.unidad)}</td>
</tr></table>

<table class="bloque"><tr>
  <td style="width:40%"><span class="et">Reportado por</span>${esc(b.reportado_por)}</td>
  <td><span class="et">Tipo de pedido</span>${casilla(b.tipo_pedido === "Normal")} Normal &nbsp;&nbsp; ${casilla(b.tipo_pedido === "Urgente")} Urgente</td>
  <td><span class="et">Prioridad</span>${esc(nombrePrioridad(b.prioridad))}</td>
  <td><span class="et">Estado</span>${esc(b.estado)}</td>
</tr><tr>
  <td><span class="et">Equipo</span>${esc(b.flota)}</td>
  <td><span class="et">Marca</span>${esc(b.marca)}</td>
  <td><span class="et">Modelo</span>${esc(b.modelo)}</td>
  <td><span class="et">Código interno</span><b>${esc(b.cod_interno)}</b></td>
</tr><tr>
  <td colspan="4"><span class="et">Descripción del trabajo</span><b>${esc(b.descripcion)}</b></td>
</tr><tr>
  <td><span class="et">Componente</span>${esc(b.componente)}</td>
  <td><span class="et">Sistema</span>${esc(b.sistema)}</td>
  <td><span class="et">Horómetro</span>${b.horometro === null ? "" : `${fNum(b.horometro)} h`}</td>
  <td><span class="et">${sap ? "Aviso / OT SAP" : "N° OT"}</span>${esc((sap ? [b.aviso_sap, b.ot_sap] : [b.ot_sap]).filter(Boolean).join(" / "))}</td>
</tr></table>

<div class="seccion">Repuestos</div>
<table><thead><tr>
  <th class="n" style="width:34px">Ítem</th><th>Número de parte</th>${sap ? "<th>Código SAP</th>" : ""}<th class="n">Cant/Req</th><th class="n">Stock</th>
  <th>Descripción del repuesto</th><th>Componente/Sistema</th><th>Observaciones</th>
</tr></thead><tbody>${filasRep.join("")}</tbody></table>

<div class="seccion">Especialidades y horas hombre</div>
<table><thead><tr><th>Especialidad</th><th class="n">Personas</th><th class="n">Horas</th><th class="n">HH</th></tr></thead>
<tbody>${filasHh}</tbody></table>

<div class="seccion">Justificación</div>
<table><tr><td class="texto">${esc(b.justificacion)}</td></tr></table>

<div class="firmas">
  <div class="firma"><div class="quien">${esc(b.reportado_por)}</div><div class="linea">Reportado por</div></div>
  <div class="firma"><div class="quien">${esc(b.aprobado_por)}</div><div class="linea">Aprobado por</div></div>
</div>
<div class="pie">Control de Backlog · ${esc(marca)} · ${esc(b.folio)}</div>
${hojaImagenes(d, logo, imagenes, logoUnidad, marca)}`;
}

export function armarFormato(
  d: DatosFormato,
  logo: string,
  imagenes: Map<string, string> = new Map(),
  logoUnidad = "",
  marca = MARCA_BASE
): string {
  return documentoImprimible(`${d.b.folio} ${d.b.descripcion}`, cuerpoFormato(d, logo, imagenes, logoUnidad, marca));
}

// Hoja 2 del formato: primero las fotos de repuestos por ítem, luego las generales.
function hojaImagenes(d: DatosFormato, logo: string, imagenes: Map<string, string>, logoUnidad: string, marca: string): string {
  const fotos = (d.fotos ?? []).filter((f) => imagenes.get(f.id));
  if (!fotos.length) return "";
  const rep = new Map(d.repuestos.map((r) => [r.id, r]));
  const ordenadas = [...fotos].sort((a, b) => {
    const ia = a.repuesto_id ? rep.get(a.repuesto_id)?.item ?? 999 : 999;
    const ib = b.repuesto_id ? rep.get(b.repuesto_id)?.item ?? 999 : 999;
    return ia - ib || a.creado_en.localeCompare(b.creado_en);
  });
  const tarjetas = ordenadas
    .map((f) => {
      const r = f.repuesto_id ? rep.get(f.repuesto_id) : undefined;
      const datos = r
        ? `<b>Ítem ${r.item}</b> · N° de parte ${esc(r.numero_parte ?? r.cod_sap ?? "")} · ${esc(r.descripcion)}`
        : "<b>Foto general del trabajo</b>";
      return `<div class="imagen"><div class="datos">${datos}</div><img src="${imagenes.get(f.id)}" alt=""></div>`;
    })
    .join("");
  return `<div class="hoja2">
<table class="enc"><tr>
  ${celdaLogos(logo, logoUnidad, d.unidad, marca)}
  <td class="titulo">IMÁGENES</td>
  <td class="datos"><span class="et">N°</span><b>${esc(d.b.folio)}</b><br><span class="et">Código interno</span>${esc(d.b.cod_interno)}</td>
</tr></table>
<div class="imagenes">${tarjetas}</div>
</div>`;
}

interface AppInfo {
  guardarPdf?: (html: string, nombre: string, vertical?: boolean) => Promise<string | null>;
}

// En el navegador la ventana de impresión se abre en el mismo clic, antes de cualquier
// espera: los navegadores del celular bloquean las que se abren después.
export function abrirVentanaImpresion(): Window | null {
  const escritorio = (window as unknown as { appInfo?: AppInfo }).appInfo;
  if (escritorio?.guardarPdf) return null;
  const v = window.open("", "_blank");
  if (!v) throw new Error("El navegador bloqueó la ventana: permita ventanas emergentes para esta página");
  v.document.write('<!doctype html><title>Generando…</title><p style="font-family:sans-serif;padding:20px">Generando…</p>');
  return v;
}

export function escribirParaImprimir(v: Window, html: string) {
  v.document.open();
  v.document.write(html.replace("</body>", "<script>window.onload = () => setTimeout(() => window.print(), 300);</script></body>"));
  v.document.close();
}

// Logos ya incrustables. Por defecto Dimelco y, si corresponde, el de la unidad a la par.
// Si alguno de los correos es de un dominio de MARCAS_DOMINIO (por ejemplo, quien creó la
// orden o quien la imprime), sale solo el logo de esa empresa y `marca` lo nombra.
export async function logosPara(
  unidad: string,
  correos: (string | null | undefined)[] = []
): Promise<{ logo: string; logoUnidad: string; marca: string }> {
  const propia = correos.map(marcaDeCorreo).find(Boolean);
  if (propia) return { logo: await comoDataUrl(propia.logo), logoUnidad: "", marca: propia.nombre };
  return {
    logo: await comoDataUrl(logoDimelco),
    logoUnidad: LOGOS_UNIDAD[unidad] ? await comoDataUrl(LOGOS_UNIDAD[unidad]) : "",
    marca: MARCA_BASE,
  };
}

// Navegador: diálogo de impresión ("Guardar como PDF"). Escritorio: guarda el PDF y
// devuelve la ruta.
export async function entregarImpresion(ventana: Window | null, html: string, nombre: string): Promise<string | null> {
  if (ventana) {
    escribirParaImprimir(ventana, html);
    return null;
  }
  const nombreArchivo = nombre.replace(/[\\/:*?"<>|]+/g, " ").slice(0, 120) + ".pdf";
  return (window as unknown as { appInfo: Required<AppInfo> }).appInfo.guardarPdf(html, nombreArchivo, true);
}

// Fotos de un backlog como data URL (id de foto -> imagen).
export async function incrustarFotos(fotos: FotoConUrl[] | undefined): Promise<Map<string, string>> {
  const imagenes = new Map<string, string>();
  for (const f of fotos ?? []) {
    if (!f.url) continue;
    const dataUrl = await comoDataUrl(f.url);
    if (dataUrl) imagenes.set(f.id, dataUrl);
  }
  return imagenes;
}

export async function imprimirFormato(d: DatosFormato): Promise<string | null> {
  const ventana = abrirVentanaImpresion();
  try {
    const imagenes = await incrustarFotos(d.fotos);
    const creador = d.perfiles.find((p) => p.user_id === d.b.creado_por)?.correo;
    const { logo, logoUnidad, marca } = await logosPara(d.unidad, [creador, d.correoImprime]);
    const html = armarFormato(d, logo, imagenes, logoUnidad, marca);
    return await entregarImpresion(ventana, html, `${d.b.folio} ${d.b.cod_interno} ${d.b.descripcion}`);
  } catch (e) {
    ventana?.close();
    throw e;
  }
}
