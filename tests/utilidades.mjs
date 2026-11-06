// Utilidades de las pruebas de navegador y de Electron.
import { deflateSync } from "node:zlib";

// Token con el usuario de la sesión (el servidor de prueba no verifica la firma).
export function token(u) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const exp = Math.floor(Date.now() / 1000) + 86400;
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: u.id, role: "authenticated", email: u.email, exp })}.prueba`;
}

// PNG de un color (sin librerías): sirve como foto de prueba.
export function png(ancho, alto, [r, g, b]) {
  const crcTabla = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const x of buf) c = crcTabla[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const trozo = (tipo, datos) => {
    const t = Buffer.from(tipo);
    const largo = Buffer.alloc(4);
    largo.writeUInt32BE(datos.length);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(Buffer.concat([t, datos])));
    return Buffer.concat([largo, t, datos, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0);
  ihdr.writeUInt32BE(alto, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const fila = Buffer.concat([Buffer.from([0]), Buffer.alloc(ancho * 3).map((_, i) => [r, g, b][i % 3])]);
  const crudo = Buffer.concat(Array.from({ length: alto }, () => fila));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), trozo("IHDR", ihdr), trozo("IDAT", deflateSync(crudo)), trozo("IEND", Buffer.alloc(0))]);
}

// Libro Excel con la disposición del formato "Mantenimiento correctivo programado"
// (como el N° 105 del usuario, sin sus logos ni datos de cliente). Hoja PS011 con 4
// repuestos, justificación, una foto y una imagen en el título que debe descartarse
// como logo; hoja JU999 con un equipo que no existe en el catálogo.
export async function libroFormato(ExcelJS) {
  const libro = new ExcelJS.Workbook();
  const logo = libro.addImage({ buffer: png(120, 40, [10, 10, 10]), extension: "png" });
  const foto = libro.addImage({ buffer: png(200, 150, [30, 150, 90]), extension: "png" });
  const hoja = (nombre, d) => {
    const h = libro.addWorksheet(nombre);
    h.getCell("F1").value = "MANTENIMIENTO CORRECTIVO PROGRAMADO ";
    h.getCell("O1").value = "Código:";
    h.getCell("O3").value = "Fecha:";
    h.getCell("Q3").value = { formula: "TODAY()" };
    h.mergeCells("A5:N5");
    h.getCell("A5").value = `N°_____${d.numero}_____`;
    h.mergeCells("O5:Q5");
    h.getCell("O5").value = d.fecha;
    h.mergeCells("A6:C6");
    h.getCell("A6").value = "Solicitado Por";
    h.mergeCells("D6:N6");
    h.getCell("D6").value = d.solicitado;
    h.mergeCells("A7:B7");
    h.getCell("A7").value = "Equipo ";
    h.getCell("C7").value = d.flota;
    h.getCell("G7").value = "Marca";
    h.getCell("H7").value = d.marca;
    h.getCell("J7").value = "Modelo ";
    h.getCell("L7").value = d.modelo;
    h.mergeCells("O7:Q7");
    h.getCell("O7").value = "     Normal                              Urgente ";
    h.getCell("A8").value = "Descripción del trabajo ";
    h.mergeCells("E8:N8");
    h.getCell("E8").value = d.descripcion;
    h.getCell("O8").value = "Codigo Interno ";
    h.getCell("Q8").value = d.cod;
    h.getRow(10).values = ["Item", "Numero de parte", null, null, "Codigo", "Cant/Req", "Stock", "Descripcion del respuesto", null, null, null, null, null, "Componente/Sistema", null, null, "Observaciones "];
    h.mergeCells("B10:D10");
    h.mergeCells("H10:M10");
    h.mergeCells("N10:P10");
    for (let i = 0; i < 15; i++) {
      const r = h.getRow(11 + i);
      r.getCell(1).value = i + 1;
      const rep = d.repuestos[i];
      if (rep) {
        r.getCell(2).value = rep[0];
        r.getCell(6).value = rep[1];
        if (rep[2] !== undefined) r.getCell(7).value = rep[2];
        r.getCell(8).value = rep[3];
        r.getCell(14).value = rep[4] ?? null;
      }
      h.mergeCells(`B${11 + i}:D${11 + i}`);
      h.mergeCells(`H${11 + i}:M${11 + i}`);
    }
    h.getCell("A26").value = "Justificación ";
    if (d.justificacion) h.getCell("A27").value = d.justificacion;
    h.getCell("A32").value = "_________________________________";
    h.getCell("A33").value = "Solicitado Por";
    h.getCell("M33").value = "Revisado y Aprobado Por";
    h.getCell("F36").value = "MANTENIMIENTO CORRECTIVO PROGRAMADO ";
    h.getCell("A40").value = "IMAGEN ";
    h.getCell("A41").value = "Item";
    h.getCell("B42").value = { formula: "+B11", result: d.repuestos[0]?.[0] ?? "" };
    h.addImage(logo, { tl: { col: 0, row: 0 }, ext: { width: 120, height: 40 } });
    h.addImage(logo, { tl: { col: 0, row: 35 }, ext: { width: 120, height: 40 } });
    if (d.foto) h.addImage(foto, { tl: { col: 7, row: 41 }, ext: { width: 200, height: 150 } });
  };
  hoja("PS011", {
    numero: "105",
    fecha: "Fecha: _14_/_10_/_26_",
    solicitado: "Xavier Araica Mora",
    flota: "Scoop",
    marca: "Epiroc",
    modelo: "ST1030",
    descripcion: "Reempaque de block de implementos por fugas de aceite",
    cod: "PS011",
    repuestos: [
      [6060003007, 2, undefined, "Juego de cierres EOD", "Block de implementos"],
      [6060013890, 2, undefined, "KIT DE RETENES (Dirección)"],
      [5541120900, 2, undefined, "JUEGO CIERRES  "],
      [6060015161, 4, 1, "Kit de sellos "],
    ],
    justificacion: "Fugas de aceite en el block; riesgo de dañar la bomba de implementos.",
    foto: true,
  });
  hoja("JU999", {
    numero: "106",
    fecha: "Fecha: _20_/_10_/_26_",
    solicitado: "Xavier Araica Mora",
    flota: "Jumbo",
    marca: "Epiroc",
    modelo: "Boomer S1D",
    descripcion: "Cambio de manguera de avance",
    cod: "JU999",
    repuestos: [["3128312800", 1, 0, "Manguera de avance"]],
  });
  return Buffer.from(await libro.xlsx.writeBuffer());
}
