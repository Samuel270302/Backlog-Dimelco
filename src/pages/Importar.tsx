import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { useBacklogs, useEquipos, useSistemas } from "../lib/queries";
import { useUnidad, useUnidades } from "../lib/unidad";
import { leerLibro, normalizar, type BacklogImportado } from "../lib/importar";
import { subirFotos } from "../lib/fotos";
import { useAvisos } from "../components/Avisos";
import { fFecha, hoyISO } from "../lib/fmt";
import { ORIGENES, PRIORIDADES, TIPOS_PEDIDO, type Equipo, type Origen, type Prioridad, type TipoPedido } from "../lib/types";

// Importación de backlogs desde el formato Excel "Mantenimiento correctivo programado".
// Entran como Identificado; el N° del papel queda como numero_formato.
interface Fila {
  clave: string;
  d: BacklogImportado;
  incluir: boolean;
  sistema_id: string;
  prioridad: Prioridad;
  tipo_pedido: TipoPedido;
  fecha: string;
  descripcion: string;
  verRepuestos: boolean;
  resultado?: { folio?: string; id?: string; error?: string; avisos?: string[] };
}

interface Revision {
  equipo: Equipo | null;
  errores: string[];
  avisos: string[];
  existente?: { id: string; folio: string };
}

export default function Importar() {
  const qc = useQueryClient();
  const { avisar } = useAvisos();
  const { unidadId } = useUnidad();
  const { data: unidades } = useUnidades();
  const { data: equipos } = useEquipos();
  const { data: backlogs } = useBacklogs();
  const { data: sistemas } = useSistemas();
  const [filas, setFilas] = useState<Fila[]>([]);
  const [leyendo, setLeyendo] = useState(false);
  const [importando, setImportando] = useState(false);
  const [origen, setOrigen] = useState<Origen>("Inspección");
  const entrada = useRef<HTMLInputElement>(null);
  const hoy = hoyISO();
  const nombreUnidad = (id: string) => unidades?.find((u) => u.id === id)?.nombre ?? "";

  async function leer(archivos: File[]) {
    setLeyendo(true);
    const nuevas: Fila[] = [];
    const sinFormato: string[] = [];
    for (const a of archivos) {
      try {
        const leidos = await leerLibro(await a.arrayBuffer(), a.name);
        if (!leidos.length) sinFormato.push(a.name);
        for (const d of leidos)
          nuevas.push({
            clave: `${a.name}|${d.hoja}|${crypto.randomUUID()}`,
            d,
            incluir: true,
            sistema_id: "",
            prioridad: "P3",
            tipo_pedido: "Normal",
            fecha: d.fecha ?? "",
            descripcion: d.descripcion ?? "",
            verRepuestos: false,
          });
      } catch (e) {
        avisar(`No se pudo leer ${a.name}: ${(e as Error).message}`, "error");
      }
    }
    setLeyendo(false);
    setFilas((x) => [...x.filter((f) => f.resultado?.folio === undefined), ...nuevas]);
    if (sinFormato.length) avisar(`Sin el formato «Mantenimiento correctivo programado»: ${sinFormato.join(", ")}`, "error");
    if (nuevas.length) avisar(`${nuevas.length} backlog(s) leído(s)`);
  }

  const cambiar = (clave: string, cambios: Partial<Fila>) => setFilas((x) => x.map((f) => (f.clave === clave ? { ...f, ...cambios } : f)));

  const revisiones = useMemo(() => {
    const m = new Map<string, Revision>();
    const vistos = new Set<string>();
    for (const f of filas) {
      const errores: string[] = [];
      const avisos: string[] = [];
      const cod = f.d.codInterno ? normalizar(f.d.codInterno) : "";
      const candidatos = (equipos ?? []).filter((e) => e.activo && normalizar(e.cod_interno) === cod);
      let equipo: Equipo | null = null;
      if (!cod) errores.push("Sin código interno");
      else if (candidatos.length === 0) errores.push(`Equipo ${f.d.codInterno} no encontrado${unidadId ? ` en ${nombreUnidad(unidadId)}` : ""}`);
      else if (candidatos.length > 1) errores.push(`${f.d.codInterno} existe en varias unidades: elija la unidad en el menú`);
      else equipo = candidatos[0];
      if (equipo) {
        if (f.d.marca && equipo.marca && normalizar(f.d.marca) !== normalizar(equipo.marca)) avisos.push(`Marca ${f.d.marca} ≠ catálogo ${equipo.marca}`);
        if (f.d.modelo && normalizar(f.d.modelo) !== normalizar(equipo.modelo)) avisos.push(`Modelo ${f.d.modelo} ≠ catálogo ${equipo.modelo}`);
      }
      let existente: Revision["existente"];
      if (equipo && f.d.numero) {
        const b = (backlogs ?? []).find((x) => x.numero_formato === f.d.numero && x.unidad_id === equipo!.unidad_id);
        if (b && f.resultado?.id !== b.id) {
          existente = { id: b.id, folio: b.folio };
          errores.push(`Ya importado como ${b.folio}`);
        }
        const k = `${equipo.unidad_id}|${f.d.numero}`;
        if (vistos.has(k) && !existente) errores.push(`N° ${f.d.numero} repetido en esta importación`);
        vistos.add(k);
      }
      if (!f.d.numero) avisos.push("Sin N° de formato");
      if (!f.fecha) errores.push("Sin fecha");
      else if (f.fecha > hoy) errores.push("Fecha futura");
      if (f.descripcion.trim().length < 5) errores.push("Sin descripción del trabajo");
      if (!f.sistema_id) errores.push("Elija el sistema");
      for (const r of f.d.repuestos) {
        if (!r.numero_parte && !r.cod_sap) errores.push(`Ítem ${r.item} sin número de parte ni código`);
        if (!r.cantidad || r.cantidad <= 0) errores.push(`Ítem ${r.item} sin cantidad`);
      }
      m.set(f.clave, { equipo, errores, avisos, existente });
    }
    return m;
  }, [filas, equipos, backlogs, unidadId, hoy]); // eslint-disable-line react-hooks/exhaustive-deps

  const pendientes = filas.filter((f) => !f.resultado?.folio);
  const listas = pendientes.filter((f) => f.incluir && revisiones.get(f.clave)?.errores.length === 0);

  async function importar() {
    setImportando(true);
    let ok = 0;
    for (const f of listas) {
      const rev = revisiones.get(f.clave)!;
      try {
        const { data, error } = await supabase()
          .from("backlogs")
          .insert({
            equipo_id: rev.equipo!.id,
            sistema_id: f.sistema_id,
            origen,
            prioridad: f.prioridad,
            tipo_pedido: f.tipo_pedido,
            fecha_deteccion: f.fecha,
            descripcion: f.descripcion.trim(),
            reportado_por: f.d.solicitado,
            justificacion: f.d.justificacion,
            numero_formato: f.d.numero,
          })
          .select("id, folio, unidad_id")
          .single();
        if (error) throw error;
        const creado = data as { id: string; folio: string; unidad_id: string };
        const avisos: string[] = [];
        if (f.d.repuestos.length) {
          const { error: e2 } = await supabase()
            .from("backlog_repuestos")
            .insert(f.d.repuestos.map((r) => ({ backlog_id: creado.id, ...r })));
          if (e2) avisos.push(`repuestos no grabados: ${e2.message}`);
        }
        if (f.d.imagenes.length) {
          const archivos = f.d.imagenes.map(
            (img, i) =>
              new File([new Uint8Array(img.datos)], `formato-${f.d.numero ?? "s-n"}-${i + 1}.${img.extension}`, {
                type: `image/${img.extension === "jpg" ? "jpeg" : img.extension}`,
              })
          );
          const r = await subirFotos(creado, archivos);
          if (r.errores.length) avisos.push(`fotos no subidas: ${r.errores.join("; ")}`);
        }
        cambiar(f.clave, { resultado: { folio: creado.folio, id: creado.id, avisos } });
        ok++;
      } catch (e) {
        cambiar(f.clave, { resultado: { error: (e as Error).message } });
      }
    }
    setImportando(false);
    qc.invalidateQueries();
    avisar(`${ok} de ${listas.length} backlog(s) importado(s)`, ok === listas.length ? "ok" : "error");
  }

  const sistemasActivos = (sistemas ?? []).filter((s) => s.activo);

  return (
    <div className="pagina-importar">
      <h1>Importar backlogs desde Excel</h1>
      <p className="subtitulo">
        Archivos con el formato «Mantenimiento correctivo programado» (una hoja por backlog; un archivo puede traer varias). Entran
        como Identificado y el N° del formato queda como referencia. Los logos del encabezado no se importan.
      </p>

      <div className="barra-acciones">
        <input
          ref={entrada}
          type="file"
          accept=".xlsx"
          multiple
          hidden
          aria-label="Archivos Excel"
          onChange={(e) => {
            const a = Array.from(e.target.files ?? []);
            e.target.value = "";
            if (a.length) void leer(a);
          }}
        />
        <button className="boton-secundario" disabled={leyendo || importando} onClick={() => entrada.current?.click()}>
          {leyendo ? "Leyendo…" : "Elegir archivos Excel"}
        </button>
        {pendientes.length > 0 && (
          <>
            <label className="campo-en-linea">
              Sistema para todos
              <select
                aria-label="Sistema para todos"
                value=""
                onChange={(e) => setFilas((x) => x.map((f) => (f.resultado?.folio ? f : { ...f, sistema_id: e.target.value })))}
              >
                <option value="">Elegir…</option>
                {sistemasActivos.map((s) => (
                  <option key={s.id} value={s.id}>{s.nombre}</option>
                ))}
              </select>
            </label>
            <label className="campo-en-linea">
              Origen
              <select aria-label="Origen" value={origen} onChange={(e) => setOrigen(e.target.value as Origen)}>
                {ORIGENES.map((o) => <option key={o}>{o}</option>)}
              </select>
            </label>
          </>
        )}
        <div className="espacio" />
        {filas.length > 0 && (
          <button className="boton-plano" disabled={importando} onClick={() => setFilas([])}>
            Limpiar
          </button>
        )}
        <button disabled={!listas.length || importando} onClick={importar}>
          {importando ? "Importando…" : `Importar ${listas.length} seleccionado(s)`}
        </button>
      </div>
      {!unidadId && (
        <p className="nota">Con «Todas las unidades» el equipo se busca en todas; si un código interno existe en dos unidades, elija la unidad en el menú.</p>
      )}

      {filas.length === 0 ? (
        <p className="nota">Elija uno o varios archivos para ver la vista previa antes de grabar.</p>
      ) : (
        <div className="tabla-marco">
          <table className="tabla-edicion tabla-importar">
            <thead>
              <tr>
                <th className="centro">Incluir</th>
                <th>Archivo / hoja</th>
                <th>N°</th>
                <th>Fecha</th>
                <th>Equipo</th>
                <th>Revisión</th>
                <th>Descripción del trabajo</th>
                <th className="num">Rep.</th>
                <th className="num">Fotos</th>
                <th>Clasificación</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => {
                const rev = revisiones.get(f.clave)!;
                const hecho = !!f.resultado?.folio;
                return [
                  <tr key={f.clave} className={hecho ? "fila-importada" : rev.errores.length ? "fila-con-error" : undefined} aria-label={`Importar ${f.d.hoja}`}>
                    <td className="centro">
                      <input
                        type="checkbox"
                        checked={f.incluir && !hecho}
                        disabled={hecho}
                        aria-label={`Incluir ${f.d.hoja}`}
                        onChange={(e) => cambiar(f.clave, { incluir: e.target.checked })}
                      />
                    </td>
                    <td>
                      <div className="nota nombre-archivo" title={f.d.archivo}>{f.d.archivo}</div>
                      {f.d.hoja}
                    </td>
                    <td>{f.d.numero ?? "—"}</td>
                    <td>
                      {hecho ? fFecha(f.fecha) : (
                        <input type="date" max={hoy} value={f.fecha} aria-label={`Fecha ${f.d.hoja}`} onChange={(e) => cambiar(f.clave, { fecha: e.target.value })} />
                      )}
                    </td>
                    <td className="celda-equipo">
                      <b>{f.d.codInterno ?? "—"}</b>
                      <div className="nota">
                        {[f.d.flota, f.d.marca, f.d.modelo].filter(Boolean).join(" · ")}
                        {rev.equipo && !unidadId ? ` · ${nombreUnidad(rev.equipo.unidad_id)}` : ""}
                      </div>
                    </td>
                    <td className="celda-revision">
                      {f.resultado?.folio ? (
                        <>
                          <span className="ok-texto">Importado </span>
                          <Link to={`/backlog/${f.resultado.id}`}>{f.resultado.folio}</Link>
                          {f.resultado.avisos?.map((a) => <div key={a} className="control-aviso">{a}</div>)}
                        </>
                      ) : (
                        <>
                          {f.resultado?.error && <div className="control-error">No se importó: {f.resultado.error}</div>}
                          {rev.existente && (
                            <div className="control-error">
                              Ya importado como <Link to={`/backlog/${rev.existente.id}`}>{rev.existente.folio}</Link>
                            </div>
                          )}
                          {rev.errores.filter((e) => !e.startsWith("Ya importado")).map((e) => <div key={e} className="control-error">{e}</div>)}
                          {rev.avisos.map((a) => <div key={a} className="control-aviso">{a}</div>)}
                          {rev.errores.length === 0 && <span className="ok-texto">Lista para importar</span>}
                        </>
                      )}
                    </td>
                    <td>
                      {hecho ? f.descripcion : (
                        <input value={f.descripcion} aria-label={`Descripción ${f.d.hoja}`} onChange={(e) => cambiar(f.clave, { descripcion: e.target.value })} />
                      )}
                    </td>
                    <td className="num">
                      <button className="boton-plano boton-chico" onClick={() => cambiar(f.clave, { verRepuestos: !f.verRepuestos })} aria-label={`Ver repuestos ${f.d.hoja}`}>
                        {f.d.repuestos.length}
                      </button>
                    </td>
                    <td className="num">{f.d.imagenes.length}</td>
                    <td className="celda-clasificacion">
                      <select value={f.sistema_id} disabled={hecho} aria-label={`Sistema ${f.d.hoja}`} onChange={(e) => cambiar(f.clave, { sistema_id: e.target.value })}>
                        <option value="">Elegir…</option>
                        {sistemasActivos.map((s) => (
                          <option key={s.id} value={s.id}>{s.nombre}</option>
                        ))}
                      </select>
                      <div className="fila-selects">
                        <select value={f.prioridad} disabled={hecho} aria-label={`Prioridad ${f.d.hoja}`} onChange={(e) => cambiar(f.clave, { prioridad: e.target.value as Prioridad })}>
                        {PRIORIDADES.map((p) => <option key={p}>{p}</option>)}
                      </select>
                        <select value={f.tipo_pedido} disabled={hecho} aria-label={`Tipo ${f.d.hoja}`} onChange={(e) => cambiar(f.clave, { tipo_pedido: e.target.value as TipoPedido })}>
                        {TIPOS_PEDIDO.map((t) => <option key={t}>{t}</option>)}
                      </select>
                      </div>
                    </td>
                  </tr>,
                  f.verRepuestos && (
                    <tr key={`${f.clave}-rep`} className="fila-detalle-importar">
                      <td />
                      <td colSpan={9}>
                        {f.d.repuestos.length === 0 ? (
                          <span className="nota">Sin repuestos.</span>
                        ) : (
                          <table className="tk-tabla">
                            <thead>
                              <tr>
                                <th className="num">Ítem</th><th>N° de parte</th><th>Código</th><th className="num">Cant</th>
                                <th className="num">Stock</th><th>Descripción</th><th>Componente/Sistema</th><th>Observaciones</th>
                              </tr>
                            </thead>
                            <tbody>
                              {f.d.repuestos.map((r) => (
                                <tr key={r.item}>
                                  <td className="num">{r.item}</td><td>{r.numero_parte}</td><td>{r.cod_sap}</td><td className="num">{r.cantidad}</td>
                                  <td className="num">{r.stock}</td><td>{r.descripcion}</td><td>{r.componente}</td><td>{r.observaciones}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                        {f.d.justificacion && <p className="nota">Justificación: {f.d.justificacion}</p>}
                        {f.d.solicitado && <p className="nota">Solicitado por: {f.d.solicitado}</p>}
                      </td>
                    </tr>
                  ),
                ];
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
