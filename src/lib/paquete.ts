// Paquete de órdenes de trabajo: todo lo programado para un equipo en un día, en un
// solo PDF para entregar a los técnicos. Carátula, una hoja por preventivo y el formato
// de cada correctivo. La pauta y el listado de filtros se adjuntan aparte.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";
import { todo, usePorUnidad } from "./queries";
import { fFecha, fNum } from "./fmt";
import {
  abrirVentanaImpresion,
  celdaLogos,
  cuerpoFormato,
  documentoImprimible,
  entregarImpresion,
  esc,
  incrustarFotos,
  logosPara,
  type DatosFormato,
} from "./formato";
import { cuerpoOtPreventivo } from "./otPreventivo";
import { leerFotosBacklog } from "./fotos";
import { leerMaterialesPreventivos } from "./preventivos";
import type {
  BacklogEvento,
  BacklogFila,
  BacklogHh,
  BacklogRepuesto,
  Catalogo,
  Paquete,
  Perfil,
  Preventivo,
  PreventivoMaterial,
} from "./types";

export const usePaquetes = () =>
  useQuery({
    queryKey: ["v_paquetes"],
    queryFn: () => todo<Paquete>("v_paquetes", "fecha"),
    select: usePorUnidad<Paquete>(),
  });

export const EN_PAQUETE = ["Programado", "Ejecutado", "Validado"];

// Órdenes que forman el paquete de un equipo y día, de lo ya cargado en pantalla.
export function ordenesDe(equipoId: string, fecha: string, backlogs: BacklogFila[], preventivos: Preventivo[]) {
  return {
    preventivos: preventivos
      .filter((p) => p.equipo_id === equipoId && p.fecha_programada === fecha && p.estado !== "Anulado")
      .sort((a, b) => a.folio.localeCompare(b.folio)),
    correctivos: backlogs
      .filter((b) => b.equipo_id === equipoId && b.fecha_programada === fecha && EN_PAQUETE.includes(b.estado))
      .sort((a, b) => a.folio.localeCompare(b.folio)),
  };
}

export interface DatosPaquete {
  folio: string;
  fecha: string;
  unidad: string;
  preventivos: { p: Preventivo; materiales: PreventivoMaterial[] }[];
  correctivos: DatosFormato[];
}

const nombreEsp = (especialidades: Catalogo[], id: string) => especialidades.find((e) => e.id === id)?.nombre ?? "";

// Carátula: equipo, lista de órdenes, repuestos de los correctivos y firmas de entrega.
export function cuerpoCaratula(d: DatosPaquete, logo: string, logoUnidad = "", marca = "Dimelco"): string {
  const primero = d.preventivos[0]?.p ?? d.correctivos[0]?.b;
  const sap = !!primero?.usa_sap;
  let n = 0;
  const filasPm = d.preventivos.map(
    ({ p }) => `<tr><td class="n">${++n}</td><td><b>${esc(p.n_ot)}</b></td><td>Preventivo</td><td>${esc(p.folio)}</td>
      <td>${esc(p.actividad)}</td><td></td><td class="n"></td><td>${esc(p.estado)}</td></tr>`
  );
  let totalHh = 0;
  const filasBl = d.correctivos.map((c) => {
    const est = c.hh.filter((h) => h.tipo === "estimada");
    const hh = est.reduce((s, h) => s + Number(h.hh), 0);
    totalHh += hh;
    const quienes = est.map((h) => `${esc(nombreEsp(c.especialidades, h.especialidad_id))} ${fNum(h.personas)} × ${fNum(h.horas)} h`).join("<br>");
    return `<tr><td class="n">${++n}</td><td><b>${esc(c.b.ot_sap)}</b></td><td>Correctivo</td><td>${esc(c.b.folio)}</td>
      <td>${esc(c.b.descripcion)}${c.b.componente ? ` · ${esc(c.b.componente)}` : ""}</td><td>${quienes}</td><td class="n">${fNum(hh)}</td><td>${esc(c.b.estado)}</td></tr>`;
  });
  const repuestos = d.correctivos.flatMap((c) => [...c.repuestos].sort((a, b) => a.item - b.item).map((r) => ({ r, folio: c.b.folio })));
  const filasRep = repuestos.length
    ? repuestos
        .map(
          ({ r, folio }) => `<tr><td>${esc(folio)}</td><td class="n">${r.item}</td><td>${esc(r.numero_parte)}</td>${sap ? `<td>${esc(r.cod_sap)}</td>` : ""}
      <td>${esc(r.descripcion)}</td><td class="n">${fNum(r.cantidad, 2)}</td><td>${esc(r.estado)}</td></tr>`
        )
        .join("")
    : `<tr><td colspan="${sap ? 7 : 6}" class="gris">Los correctivos del paquete no tienen repuestos cargados.</td></tr>`;

  return `<table class="enc"><tr>
  ${celdaLogos(logo, logoUnidad, d.unidad, marca)}
  <td class="titulo">PAQUETE DE ÓRDENES DE TRABAJO</td>
  <td class="datos"><span class="et">N° de paquete</span><b>${esc(d.folio)}</b><br><span class="et">Fecha programada</span><b>${fFecha(d.fecha)}</b><br><span class="et">Unidad</span>${esc(d.unidad)}</td>
</tr></table>

<table class="bloque"><tr>
  <td style="width:28%"><span class="et">Equipo</span>${esc(primero?.flota)}</td>
  <td><span class="et">Marca</span>${esc(primero?.marca)}</td>
  <td><span class="et">Modelo</span>${esc(primero?.modelo)}</td>
  <td><span class="et">Código interno</span><b class="caratula-dato">${esc(primero?.cod_interno)}</b></td>
</tr></table>

<div class="seccion">Órdenes del paquete (${n})</div>
<table><thead><tr>
  <th class="n" style="width:26px">#</th><th>${sap ? "OT SAP" : "N° OT"}</th><th>Clase</th><th>Folio</th><th>Actividad</th>
  <th>Especialidades</th><th class="n">HH</th><th>Estado</th>
</tr></thead><tbody>${filasPm.join("")}${filasBl.join("")}
${d.correctivos.length ? `<tr class="total"><td colspan="6">Total HH estimadas de los correctivos</td><td class="n">${fNum(totalHh)}</td><td></td></tr>` : ""}</tbody></table>

${
  d.correctivos.length
    ? `<div class="seccion">Repuestos de los correctivos</div>
<table><thead><tr>
  <th>Folio</th><th class="n" style="width:34px">Ítem</th><th>Número de parte</th>${sap ? "<th>Código SAP</th>" : ""}<th>Descripción</th><th class="n">Cant/Req</th><th>Estado</th>
</tr></thead><tbody>${filasRep}</tbody></table>`
    : ""
}
${
  d.preventivos.length
    ? `<div class="aviso-adjuntos">Pauta de mantenimiento y listado de filtros adjuntos: &#9744; Sí &nbsp;&nbsp; &#9744; No</div>`
    : ""
}

<div class="seccion">Observaciones de la entrega</div>
<table class="caja-alta"><tr><td class="texto"></td></tr></table>

<div class="firmas">
  <div class="firma"><div class="quien"></div><div class="linea">Entregado por (planificador)</div></div>
  <div class="firma"><div class="quien"></div><div class="linea">Recibido por (técnico o supervisor)</div></div>
</div>
<div class="pie">Control de Backlog · ${esc(marca)} · ${esc(d.folio)} · ${esc(primero?.cod_interno)} · ${fFecha(d.fecha)}</div>`;
}

// Cuerpos del paquete en orden: carátula, preventivos, correctivos.
export function cuerposPaquete(
  d: DatosPaquete,
  logo: string,
  logoUnidad: string,
  imagenes: Map<string, Map<string, string>>,
  marca = "Dimelco"
): string[] {
  return [
    cuerpoCaratula(d, logo, logoUnidad, marca),
    ...d.preventivos.map(({ p, materiales }) => cuerpoOtPreventivo(p, materiales, logo, logoUnidad, d.folio, marca)),
    ...d.correctivos.map((c) => cuerpoFormato(c, logo, imagenes.get(c.b.id) ?? new Map(), logoUnidad, marca)),
  ];
}

async function porBacklogs<T extends { backlog_id: string }>(tabla: string, ids: string[]): Promise<Map<string, T[]>> {
  const m = new Map<string, T[]>();
  for (let i = 0; i < ids.length; i += 80) {
    const { data, error } = await supabase().from(tabla).select("*").in("backlog_id", ids.slice(i, i + 80));
    if (error) throw error;
    for (const f of data as T[]) m.set(f.backlog_id, [...(m.get(f.backlog_id) ?? []), f]);
  }
  return m;
}

export interface ContextoPaquete {
  backlogs: BacklogFila[];
  preventivos: Preventivo[];
  especialidades: Catalogo[];
  perfiles: Perfil[];
  nombreUnidad: (id: string) => string;
  // Correo de quien imprime: si es @explotec.com, todo el paquete sale solo con el logo de Explotec.
  correoImprime?: string | null;
}

// Imprime uno o varios paquetes (equipo y día) en un solo PDF. La base asigna o
// recupera el número de cada paquete.
export async function imprimirPaquetes(claves: { equipo_id: string; fecha: string }[], ctx: ContextoPaquete): Promise<{ ruta: string | null; folios: string[] }> {
  const ventana = abrirVentanaImpresion();
  try {
    const cuerpos: string[] = [];
    const folios: string[] = [];
    let titulo = "";
    for (const clave of claves) {
      const { preventivos, correctivos } = ordenesDe(clave.equipo_id, clave.fecha, ctx.backlogs, ctx.preventivos);
      if (!preventivos.length && !correctivos.length) continue;
      const { data, error } = await supabase().rpc("paquete_de", { p_equipo: clave.equipo_id, p_fecha: clave.fecha });
      if (error) throw new Error(error.message);
      const paquete = data as { folio: string; unidad_id: string };
      const ids = correctivos.map((b) => b.id);
      const [repuestos, hh, eventos, materiales] = await Promise.all([
        porBacklogs<BacklogRepuesto>("backlog_repuestos", ids),
        porBacklogs<BacklogHh>("backlog_hh", ids),
        porBacklogs<BacklogEvento>("backlog_eventos", ids),
        leerMaterialesPreventivos(preventivos.map((p) => p.id)),
      ]);
      const unidad = ctx.nombreUnidad(paquete.unidad_id);
      const imagenes = new Map<string, Map<string, string>>();
      const datosCorrectivos: DatosFormato[] = [];
      for (const b of correctivos) {
        const fotos = await leerFotosBacklog(b.id);
        imagenes.set(b.id, await incrustarFotos(fotos));
        datosCorrectivos.push({
          b,
          repuestos: repuestos.get(b.id) ?? [],
          hh: hh.get(b.id) ?? [],
          especialidades: ctx.especialidades,
          eventos: eventos.get(b.id) ?? [],
          perfiles: ctx.perfiles,
          unidad,
          fotos,
        });
      }
      const d: DatosPaquete = {
        folio: paquete.folio,
        fecha: clave.fecha,
        unidad,
        preventivos: preventivos.map((p) => ({ p, materiales: materiales.filter((m) => m.preventivo_id === p.id) })),
        correctivos: datosCorrectivos,
      };
      const { logo, logoUnidad, marca } = await logosPara(unidad, [ctx.correoImprime]);
      cuerpos.push(...cuerposPaquete(d, logo, logoUnidad, imagenes, marca));
      folios.push(paquete.folio);
      const cod = preventivos[0]?.cod_interno ?? correctivos[0]?.cod_interno ?? "";
      titulo = folios.length === 1 ? `${paquete.folio} ${cod} ${clave.fecha}` : `Paquetes ${clave.fecha} (${folios.length})`;
    }
    if (!cuerpos.length) throw new Error("No hay órdenes programadas para armar el paquete");
    const html = documentoImprimible(titulo, ...cuerpos);
    return { ruta: await entregarImpresion(ventana, html, titulo), folios };
  } catch (e) {
    ventana?.close();
    throw e;
  }
}
