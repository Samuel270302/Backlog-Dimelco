// Orden de trabajo imprimible de un preventivo. No lleva tareas ni kits: la pauta de
// mantenimiento y el listado de filtros los imprime el planificador y se adjuntan.
import { fFecha, fNum } from "./fmt";
import { abrirVentanaImpresion, celdaLogos, documentoImprimible, entregarImpresion, esc, logosPara } from "./formato";
import type { Preventivo, PreventivoMaterial } from "./types";

const FILAS_MINIMAS_MATERIALES = 12;

export function cuerpoOtPreventivo(
  p: Preventivo,
  materiales: PreventivoMaterial[],
  logo: string,
  logoUnidad = "",
  paquete = "",
  marca = "Dimelco"
): string {
  const sap = p.usa_sap;
  const ordenados = [...materiales].sort((a, b) => a.item - b.item);
  const filas = ordenados.map(
    (m) => `<tr><td class="n">${m.item}</td><td>${esc(m.numero_parte)}</td><td>${esc(m.cod_sap)}</td>
      <td>${esc(m.descripcion)}</td><td class="n">${fNum(m.cantidad, 2)}</td><td>${esc(m.um)}</td><td>${esc(m.observaciones)}</td></tr>`
  );
  for (let i = ordenados.length; i < FILAS_MINIMAS_MATERIALES; i++) {
    filas.push(`<tr class="vacia"><td class="n">${i + 1}</td>${"<td></td>".repeat(6)}</tr>`);
  }
  const ejecutado = p.estado === "Ejecutado";
  return `<table class="enc"><tr>
  ${celdaLogos(logo, logoUnidad, p.unidad, marca)}
  <td class="titulo">ORDEN DE TRABAJO<br>MANTENIMIENTO PREVENTIVO</td>
  <td class="datos"><span class="et">${sap ? "OT SAP" : "N° OT"}</span><b>${esc(p.n_ot)}</b><br><span class="et">Preventivo</span>${esc(p.folio)}<br><span class="et">Unidad</span>${esc(p.unidad)}${
    paquete ? `<br><span class="et">Paquete</span>${esc(paquete)}` : ""
  }</td>
</tr></table>

<table class="bloque"><tr>
  <td style="width:28%"><span class="et">Equipo</span>${esc(p.flota)}</td>
  <td><span class="et">Marca</span>${esc(p.marca)}</td>
  <td><span class="et">Modelo</span>${esc(p.modelo)}</td>
  <td><span class="et">Código interno</span><b>${esc(p.cod_interno)}</b></td>
</tr><tr>
  <td colspan="4"><span class="et">Actividad</span><b>${esc(p.actividad)}</b></td>
</tr><tr>
  <td><span class="et">Fecha programada</span>${fFecha(p.fecha_programada)}</td>
  <td><span class="et">Horómetro programado</span>${p.horometro_programado === null ? "" : `${fNum(p.horometro_programado)} h`}</td>
  <td colspan="2"><span class="et">Observaciones</span>${esc(p.observaciones)}</td>
</tr></table>

<div class="aviso-adjuntos">Pauta de mantenimiento y listado de filtros adjuntos: &#9744; Sí &nbsp;&nbsp; &#9744; No</div>

<div class="seccion">Ejecución</div>
<table class="casillas"><tr>
  <td><span class="et">Fecha de ejecución</span>${ejecutado ? fFecha(p.fecha_ejecucion) : ""}</td>
  <td><span class="et">Hora de inicio</span></td>
  <td><span class="et">Hora de fin</span></td>
  <td><span class="et">Horómetro al ejecutar</span>${p.horometro_ejecucion === null ? "" : `${fNum(p.horometro_ejecucion)} h`}</td>
</tr></table>

<div class="seccion">Materiales utilizados</div>
<table><thead><tr>
  <th class="n" style="width:34px">Ítem</th><th>Número de parte</th><th>${sap ? "Código SAP" : "Cód. interno"}</th><th>Descripción</th>
  <th class="n">Cantidad</th><th>Unidad</th><th>Observaciones</th>
</tr></thead><tbody>${filas.join("")}</tbody></table>

<div class="seccion">Observaciones del técnico</div>
<table class="caja-alta"><tr><td class="texto">${esc(p.comentario_cierre)}</td></tr></table>

<div class="firmas">
  <div class="firma"><div class="quien">${esc(p.ejecutado_por)}</div><div class="linea">Ejecutado por</div></div>
  <div class="firma"><div class="quien"></div><div class="linea">Recibido conforme</div></div>
</div>
<div class="pie">Control de Backlog · ${esc(marca)} · ${esc(p.folio)} · OT ${esc(p.n_ot)}</div>`;
}

// correos: el de quien creó el preventivo y el de quien imprime; si alguno es @explotec.com
// la orden sale solo con el logo de Explotec.
export async function imprimirOtPreventivo(
  p: Preventivo,
  materiales: PreventivoMaterial[],
  correos: (string | null | undefined)[] = []
): Promise<string | null> {
  const ventana = abrirVentanaImpresion();
  try {
    const { logo, logoUnidad, marca } = await logosPara(p.unidad, correos);
    const html = documentoImprimible(`${p.folio} ${p.actividad}`, cuerpoOtPreventivo(p, materiales, logo, logoUnidad, "", marca));
    return await entregarImpresion(ventana, html, `${p.folio} ${p.cod_interno} ${p.actividad}`);
  } catch (e) {
    ventana?.close();
    throw e;
  }
}
