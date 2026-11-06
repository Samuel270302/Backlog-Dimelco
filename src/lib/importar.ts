// Lectura de backlogs desde el formato Excel "Mantenimiento correctivo programado".
// Sin React: lo usa la pantalla Importar y se puede probar aparte. Los datos se ubican
// por sus etiquetas (no por celda fija), así toleran filas o columnas corridas.
import ExcelJS from "exceljs";

export interface RepuestoImportado {
  item: number;
  numero_parte: string | null;
  cod_sap: string | null;
  cantidad: number | null;
  stock: number | null;
  descripcion: string | null;
  componente: string | null;
  observaciones: string | null;
}

export interface ImagenImportada {
  datos: Uint8Array;
  extension: string;
}

export interface BacklogImportado {
  archivo: string;
  hoja: string;
  numero: string | null;
  fecha: string | null; // YYYY-MM-DD
  solicitado: string | null;
  flota: string | null;
  marca: string | null;
  modelo: string | null;
  codInterno: string | null;
  descripcion: string | null;
  justificacion: string | null;
  repuestos: RepuestoImportado[];
  imagenes: ImagenImportada[];
  logosDescartados: number;
}

const TITULO = "mantenimiento correctivo programado";

export const normalizar = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

// Texto de una celda, sea texto, número, fecha, texto enriquecido, hipervínculo o fórmula.
function texto(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((r) => r.text).join("").trim();
    if ("text" in v && typeof v.text === "string") return v.text.trim();
    if ("result" in v) return texto(v.result as ExcelJS.CellValue);
  }
  return "";
}

const numero = (s: string): number | null => {
  if (!s) return null;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
const nulo = (s: string) => (s === "" ? null : s);

interface Celda {
  fila: number;
  col: number;
  valor: string;
  norm: string;
}

// Celdas con contenido de la hoja, sin repetir las combinadas (ExcelJS repite el valor
// de la celda maestra en cada celda de la combinación).
function celdas(hoja: ExcelJS.Worksheet): Celda[] {
  const salida: Celda[] = [];
  hoja.eachRow({ includeEmpty: false }, (fila, nf) => {
    fila.eachCell({ includeEmpty: false }, (c, nc) => {
      if (c.isMerged && c.master.address !== c.address) return;
      const valor = texto(c.value);
      if (valor) salida.push({ fila: nf, col: nc, valor, norm: normalizar(valor) });
    });
  });
  return salida;
}

// N° y fecha vienen escritos sobre guiones bajos: "N°_____105_____", "Fecha: _14_/_10_/_26_".
export function extraerNumero(s: string): string | null {
  const m = /(\d+)/.exec(s.replace(/^\s*n\s*[°º.o]?\s*/i, ""));
  return m ? m[1] : null;
}

export function extraerFecha(s: string): string | null {
  const m = /(\d{1,2})\D+(\d{1,2})\D+(\d{2,4})/.exec(s);
  if (!m) return null;
  const dia = Number(m[1]);
  const mes = Number(m[2]);
  let anio = Number(m[3]);
  if (anio < 100) anio += 2000;
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  if (d.getUTCMonth() !== mes - 1) return null;
  return d.toISOString().slice(0, 10);
}

const COLUMNAS: [keyof Omit<RepuestoImportado, "item">, (n: string) => boolean][] = [
  ["numero_parte", (n) => n.startsWith("numero de parte") || n.startsWith("n° de parte") || n === "n de parte"],
  ["cod_sap", (n) => n === "codigo" || n === "codigo sap"],
  ["cantidad", (n) => n.startsWith("cant")],
  ["stock", (n) => n === "stock"],
  ["descripcion", (n) => n.startsWith("descripcion")],
  ["componente", (n) => n.startsWith("componente")],
  ["observaciones", (n) => n.startsWith("observacion")],
];

function leerHoja(hoja: ExcelJS.Worksheet, libro: ExcelJS.Workbook, archivo: string): BacklogImportado | null {
  const todas = celdas(hoja);
  const titulos = todas.filter((c) => c.norm.includes(TITULO)).map((c) => c.fila);
  if (!titulos.length) return null;
  // Primera sección: desde el primer título hasta el siguiente (la hoja de imágenes repite el encabezado).
  const fin = titulos.find((f) => f > titulos[0]) ?? Infinity;
  const sec = todas.filter((c) => c.fila >= titulos[0] && c.fila < fin);

  const etiqueta = (pred: (n: string) => boolean) => sec.find((c) => pred(c.norm));
  // Valor de una etiqueta: la primera celda con contenido a su derecha en la misma fila.
  const derecha = (c: Celda | undefined) =>
    c ? (sec.filter((x) => x.fila === c.fila && x.col > c.col).sort((a, b) => a.col - b.col)[0]?.valor ?? "") : "";

  const celNumero = etiqueta((n) => /^n\s*[°º]/.test(n));
  const celFecha = sec.find((c) => c.norm.startsWith("fecha") && /\d/.test(c.valor) && extraerFecha(c.valor));

  // Tabla de repuestos: fila de encabezados con "item" y "numero de parte".
  const encItem = sec.find((c) => c.norm === "item" && sec.some((x) => x.fila === c.fila && x.norm.startsWith("numero de parte")));
  const celJust = etiqueta((n) => n.startsWith("justificacion"));
  const repuestos: RepuestoImportado[] = [];
  if (encItem) {
    const cols = new Map<string, number>();
    for (const c of sec.filter((x) => x.fila === encItem.fila)) {
      const campo = COLUMNAS.find(([, pred]) => pred(c.norm));
      if (campo && !cols.has(campo[0])) cols.set(campo[0], c.col);
    }
    const hasta = celJust?.fila ?? fin;
    for (let f = encItem.fila + 1; f < hasta; f++) {
      const filaCeldas = sec.filter((c) => c.fila === f);
      const de = (campo: string) => filaCeldas.find((c) => c.col === cols.get(campo))?.valor ?? "";
      const r = {
        numero_parte: nulo(de("numero_parte")),
        cod_sap: nulo(de("cod_sap")),
        cantidad: numero(de("cantidad")),
        stock: numero(de("stock")),
        descripcion: nulo(de("descripcion")),
        componente: nulo(de("componente")),
        observaciones: nulo(de("observaciones")),
      };
      if (!r.numero_parte && !r.cod_sap && !r.descripcion) continue; // fila con solo el número de ítem
      repuestos.push({ item: repuestos.length + 1, ...r });
    }
  }

  // Justificación: texto en la fila de la etiqueta y debajo, hasta la línea de firmas.
  let justificacion: string | null = null;
  if (celJust) {
    const firmas = sec.find((c) => c.fila > celJust.fila && (/^_{5,}/.test(c.valor) || c.norm.startsWith("solicitado por")))?.fila ?? fin;
    const partes = sec
      .filter((c) => c !== celJust && c.fila >= celJust.fila && c.fila < firmas && !(c.fila === celJust.fila && c.col < celJust.col))
      .sort((a, b) => a.fila - b.fila || a.col - b.col)
      .map((c) => c.valor);
    justificacion = partes.length ? partes.join("\n") : null;
  }

  // Imágenes: las ancladas junto a un título son logos del encabezado y se descartan.
  const imagenes: ImagenImportada[] = [];
  let logosDescartados = 0;
  for (const img of hoja.getImages()) {
    const filaImg = Math.floor(Number(img.range.tl.nativeRow ?? img.range.tl.row ?? 0)) + 1;
    if (titulos.some((t) => Math.abs(filaImg - t) <= 3)) {
      logosDescartados++;
      continue;
    }
    const medio = libro.getImage(Number(img.imageId)) as unknown as { buffer?: ArrayBuffer | Uint8Array; base64?: string; extension: string };
    let datos: Uint8Array | null = null;
    if (medio.buffer) datos = medio.buffer instanceof Uint8Array ? medio.buffer : new Uint8Array(medio.buffer);
    else if (medio.base64) datos = Uint8Array.from(atob(medio.base64.replace(/^data:[^,]+,/, "")), (ch) => ch.charCodeAt(0));
    if (datos) imagenes.push({ datos, extension: (medio.extension || "png").toLowerCase() });
  }

  return {
    archivo,
    hoja: hoja.name,
    numero: celNumero ? extraerNumero(celNumero.valor) : null,
    fecha: celFecha ? extraerFecha(celFecha.valor) : null,
    solicitado: nulo(derecha(etiqueta((n) => n.startsWith("solicitado por")))),
    flota: nulo(derecha(etiqueta((n) => n === "equipo"))),
    marca: nulo(derecha(etiqueta((n) => n === "marca"))),
    modelo: nulo(derecha(etiqueta((n) => n === "modelo"))),
    codInterno: nulo(derecha(etiqueta((n) => n.startsWith("codigo interno")))),
    descripcion: nulo(derecha(etiqueta((n) => n.startsWith("descripcion del trabajo")))),
    justificacion,
    repuestos,
    imagenes,
    logosDescartados,
  };
}

// Lee todas las hojas con el formato; las demás se ignoran.
export async function leerLibro(buffer: ArrayBuffer, archivo: string): Promise<BacklogImportado[]> {
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(buffer);
  const salida: BacklogImportado[] = [];
  for (const hoja of libro.worksheets) {
    const b = leerHoja(hoja, libro, archivo);
    if (b) salida.push(b);
  }
  return salida;
}
