import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth";
import { useBacklogs, useCapacidadVigente, useEspecialidades } from "../lib/queries";
import { lunesDe, useDetalleBacklogs } from "../lib/backlog";
import { useCambioEstado, useTransicionesPermitidas } from "../components/CambioEstado";
import { EtiquetaPrioridad } from "../components/Etiquetas";
import { fFecha, fNum, hoyISO, sumarDiasISO } from "../lib/fmt";
import { usePreventivos } from "../lib/preventivos";
import { useAccionesPreventivo } from "../components/preventivos/AccionesPreventivo";
import { DialogoPaquete, useImprimirPaquetes, type ClavePaquete } from "../components/paquetes/Paquetes";
import type { BacklogFila, Preventivo } from "../lib/types";

// Programa semanal: backlogs y preventivos programados por equipo y día, panel de listos
// para programar y carga de HH por especialidad contra la capacidad del taller (los
// preventivos no llevan HH).
const DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const EN_CALENDARIO = ["Programado", "Ejecutado", "Validado"];

const ordenListos = (a: BacklogFila, b: BacklogFila) =>
  Number(b.tipo_pedido === "Urgente") - Number(a.tipo_pedido === "Urgente") ||
  a.prioridad.localeCompare(b.prioridad) ||
  (a.dias_para_limite ?? 9999) - (b.dias_para_limite ?? 9999);

function nivel(uso: number) {
  if (uso > 1) return "excedida";
  if (uso > 0.85) return "alta";
  return "normal";
}

export default function Calendario() {
  const { puedeCapturar } = useAuth();
  const hoy = hoyISO();
  const [lunes, setLunes] = useState(() => lunesDe(hoy));
  const dias = useMemo(() => Array.from({ length: 7 }, (_, i) => sumarDiasISO(lunes, i)), [lunes]);
  const domingo = dias[6];
  const { data: backlogs, isLoading } = useBacklogs();
  const { data: especialidades } = useEspecialidades();
  const { data: capacidad } = useCapacidadVigente();
  const permitidas = useTransicionesPermitidas();
  const cambio = useCambioEstado();
  const { data: preventivos } = usePreventivos();
  const pm = useAccionesPreventivo();
  const [arrastrando, setArrastrando] = useState<BacklogFila | null>(null);
  const [arrastrandoPm, setArrastrandoPm] = useState<Preventivo | null>(null);
  const [paquete, setPaquete] = useState<ClavePaquete | null>(null);
  const paquetes = useImprimirPaquetes();
  const [sobreDia, setSobreDia] = useState<string | null>(null);

  const semana = useMemo(
    () =>
      (backlogs ?? []).filter(
        (b) => EN_CALENDARIO.includes(b.estado) && b.fecha_programada && b.fecha_programada >= lunes && b.fecha_programada <= domingo
      ),
    [backlogs, lunes, domingo]
  );
  const pmSemana = useMemo(
    () => (preventivos ?? []).filter((p) => p.estado !== "Anulado" && p.fecha_programada >= lunes && p.fecha_programada <= domingo),
    [preventivos, lunes, domingo]
  );
  // Equipo y día con preventivo: los correctivos de esa parada se marcan "con PM".
  const conPm = useMemo(() => new Set(pmSemana.map((p) => `${p.equipo_id}|${p.fecha_programada}`)), [pmSemana]);
  const listos = useMemo(() => (backlogs ?? []).filter((b) => b.estado === "Listo para programar").sort(ordenListos), [backlogs]);
  const { data: detalle } = useDetalleBacklogs(semana.map((b) => b.id));

  const filas = useMemo(() => {
    const m = new Map<string, { cod: string; modelo: string; items: BacklogFila[]; pms: Preventivo[] }>();
    const fila = (x: { equipo_id: string; cod_interno: string; modelo: string }) => {
      const f = m.get(x.equipo_id) ?? { cod: x.cod_interno, modelo: x.modelo, items: [], pms: [] };
      m.set(x.equipo_id, f);
      return f;
    };
    for (const b of semana) fila(b).items.push(b);
    for (const p of pmSemana) fila(p).pms.push(p);
    return [...m.entries()].sort((a, b) => a[1].cod.localeCompare(b[1].cod));
  }, [semana, pmSemana]);

  // Carga de la semana por especialidad (HH estimadas de lo programado) contra la capacidad.
  const carga = useMemo(() => {
    const programadas = new Map<string, number>();
    for (const b of semana) {
      for (const h of detalle?.hh.get(b.id) ?? []) {
        if (h.tipo === "estimada") programadas.set(h.especialidad_id, (programadas.get(h.especialidad_id) ?? 0) + Number(h.hh));
      }
    }
    const cap = new Map<string, number>();
    for (const c of capacidad ?? []) cap.set(c.especialidad_id, (cap.get(c.especialidad_id) ?? 0) + Number(c.hh_semana));
    return (especialidades ?? [])
      .filter((e) => e.activo || programadas.has(e.id))
      .map((e) => ({ id: e.id, nombre: e.nombre, hh: programadas.get(e.id) ?? 0, capacidad: cap.get(e.id) ?? 0 }))
      .filter((x) => x.hh > 0 || x.capacidad > 0);
  }, [semana, detalle, capacidad, especialidades]);

  // Paquetes de un día: uno por equipo con órdenes programadas esa fecha.
  const clavesDia = (d: string): ClavePaquete[] =>
    filas
      .filter(([, f]) => f.items.some((b) => b.fecha_programada === d) || f.pms.some((p) => p.fecha_programada === d))
      .map(([equipo_id]) => ({ equipo_id, fecha: d }));

  const totalDia = (d: string) =>
    semana.filter((b) => b.fecha_programada === d).reduce((s, b) => s + Number(b.hh_estimadas), 0);

  // Transición que corresponde al soltar en un día: programar un listo o reprogramar un
  // programado. Se admite un día pasado, pero no anterior a la detección del backlog (019).
  function transicionAlSoltar(b: BacklogFila, dia: string) {
    if (dia < b.fecha_deteccion) return undefined;
    if (b.estado === "Listo para programar") return permitidas(b.estado).find((t) => t.destino === "Programado");
    if (b.estado === "Programado" && b.fecha_programada !== dia)
      return permitidas(b.estado).find((t) => t.etiqueta === "Reprogramar");
    return undefined;
  }

  // Un preventivo programado se suelta en cualquier otro día: abre Reprogramar.
  const admiteSoltar = (dia: string) =>
    (!!arrastrando && !!transicionAlSoltar(arrastrando, dia)) || (!!arrastrandoPm && arrastrandoPm.fecha_programada !== dia);

  const zonaDia = (dia: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!admiteSoltar(dia)) return;
      e.preventDefault();
      setSobreDia(dia);
    },
    onDragLeave: () => setSobreDia((d) => (d === dia ? null : d)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      const b = arrastrando;
      const p = arrastrandoPm;
      setArrastrando(null);
      setArrastrandoPm(null);
      setSobreDia(null);
      if (p) {
        if (p.fecha_programada !== dia) pm.abrir(p, "reprogramar", dia);
        return;
      }
      if (!b) return;
      const t = transicionAlSoltar(b, dia);
      if (t) cambio.abrir(b, t, dia);
    },
  });
  const claseDia = (dia: string) =>
    [
      dia === hoy ? "hoy" : "",
      dia < hoy ? "pasado" : "",
      admiteSoltar(dia) ? "admite" : "",
      sobreDia === dia ? "sobre" : "",
    ]
      .filter(Boolean)
      .join(" ");

  const arrastre = (b: BacklogFila) =>
    puedeCapturar && (b.estado === "Listo para programar" || b.estado === "Programado")
      ? {
          draggable: true,
          onDragStart: (e: React.DragEvent) => {
            e.dataTransfer.setData("text/plain", b.id);
            e.dataTransfer.effectAllowed = "move";
            setArrastrando(b);
          },
          onDragEnd: () => {
            setArrastrando(null);
            setSobreDia(null);
          },
        }
      : {};

  const arrastrePm = (p: Preventivo) =>
    puedeCapturar && p.estado === "Programado"
      ? {
          draggable: true,
          onDragStart: (e: React.DragEvent) => {
            e.dataTransfer.setData("text/plain", p.id);
            e.dataTransfer.effectAllowed = "move";
            setArrastrandoPm(p);
          },
          onDragEnd: () => {
            setArrastrandoPm(null);
            setSobreDia(null);
          },
        }
      : {};

  // Tarjeta de un preventivo en la celda de su equipo y día.
  const tarjetaPm = (p: Preventivo) => (
    <div
      key={p.id}
      className={`tarjeta-cal pm${p.estado === "Ejecutado" ? " hecha" : ""}`}
      aria-label={`${p.folio} ${p.cod_interno}`}
      {...arrastrePm(p)}
    >
      <div className="tc-linea1">
        <Link to={`/preventivo/${p.id}`} className="tc-folio" draggable={false}>
          {p.folio}
        </Link>
        <span className="etiqueta-pm">PM</span>
      </div>
      <div className="tc-trabajo">{p.actividad}</div>
      <div className="tc-datos">
        <span>{p.n_ot.startsWith("OT") ? p.n_ot : `OT ${p.n_ot}`}</span>
        {p.estado !== "Programado" && <span>{p.estado}</span>}
      </div>
    </div>
  );

  return (
    <div className="pagina-calendario">
      <div className="barra-acciones">
        <h1 style={{ margin: 0 }}>Calendario</h1>
        <span className="semana-titulo">
          Semana del {fFecha(lunes)} al {fFecha(domingo)}
        </span>
        <div className="espacio" />
        {puedeCapturar && <button onClick={() => pm.programar({ fecha: hoy >= lunes && hoy <= domingo ? hoy : lunes })}>Programar preventivo</button>}
        <button className="boton-plano" onClick={() => setLunes(sumarDiasISO(lunes, -7))} aria-label="Semana anterior">
          ‹ Anterior
        </button>
        <button className="boton-plano" onClick={() => setLunes(lunesDe(hoy))} disabled={lunes === lunesDe(hoy)}>
          Hoy
        </button>
        <button className="boton-plano" onClick={() => setLunes(sumarDiasISO(lunes, 7))} aria-label="Semana siguiente">
          Siguiente ›
        </button>
      </div>

      <section className="carga-semana" aria-label="Carga de la semana">
        {carga.length === 0 && <p className="nota">Sin HH programadas ni capacidad cargada para esta semana.</p>}
        {carga.map((c) => {
          const uso = c.capacidad > 0 ? c.hh / c.capacidad : 0;
          return (
            <div key={c.id} className="barra-carga" aria-label={`Carga ${c.nombre}`}>
              <div className="bc-texto">
                <span>{c.nombre}</span>
                <span>
                  {fNum(c.hh)} / {c.capacidad > 0 ? `${fNum(c.capacidad)} HH` : "sin capacidad"}
                  {c.capacidad > 0 && ` · ${Math.round(uso * 100)} %`}
                </span>
              </div>
              <div className="bc-fondo">
                <div
                  className={`bc-relleno ${c.capacidad > 0 ? nivel(uso) : "sin-capacidad"}`}
                  style={{ width: `${Math.min(100, c.capacidad > 0 ? uso * 100 : c.hh > 0 ? 100 : 0)}%` }}
                />
              </div>
            </div>
          );
        })}
      </section>

      <div className="calendario">
        <aside className="panel-listos" aria-label="Listos para programar">
          <h2>
            Listos para programar <span className="nota">{listos.length}</span>
          </h2>
          {puedeCapturar && listos.length > 0 && <p className="nota">Arrastre al día en que se hará el trabajo.</p>}
          {listos.length === 0 && <p className="nota">No hay backlogs listos.</p>}
          {listos.map((b) => (
            <div key={b.id} className={`tarjeta-cal listo${b.vencido ? " vencida" : ""}`} aria-label={`${b.folio} ${b.cod_interno}`} {...arrastre(b)}>
              <div className="tc-linea1">
                <Link to={`/backlog/${b.id}`} className="tc-folio" draggable={false}>
                  {b.folio}
                </Link>
                {b.tipo_pedido === "Urgente" && <span className="etiqueta-urgente">Urgente</span>}
                <EtiquetaPrioridad prioridad={b.prioridad} />
              </div>
              <div className="tc-equipo">{b.cod_interno}</div>
              <div className="tc-trabajo">{b.descripcion}</div>
              <div className="tc-datos">
                <span>{fNum(b.hh_estimadas)} HH</span>
                <span className={b.vencido ? "texto-vencido" : undefined}>límite {fFecha(b.fecha_limite)}</span>
              </div>
            </div>
          ))}
        </aside>

        <div className="tabla-marco grilla-semana">
          <table>
            <thead>
              <tr>
                <th className="col-equipo">Equipo</th>
                {dias.map((d, i) => (
                  <th key={d} className={claseDia(d)} {...zonaDia(d)} aria-label={`Día ${fFecha(d)}`}>
                    {DIAS[i]} {d.slice(8, 10)}/{d.slice(5, 7)}
                    {puedeCapturar && clavesDia(d).length > 0 && (
                      <button
                        className="boton-plano boton-paquetes-dia"
                        disabled={paquetes.ocupado}
                        aria-label={`Imprimir paquetes del ${fFecha(d)}`}
                        title="Imprimir en un solo PDF los paquetes de todos los equipos de este día"
                        onClick={() => paquetes.imprimir(clavesDia(d))}
                      >
                        Paquetes ({clavesDia(d).length})
                      </button>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filas.map(([equipoId, f]) => (
                <tr key={equipoId}>
                  <td className="col-equipo">
                    <Link to={`/equipo/${equipoId}`}>{f.cod}</Link>
                    <div className="nota">{f.modelo}</div>
                  </td>
                  {dias.map((d) => (
                    <td key={d} className={claseDia(d)} {...zonaDia(d)}>
                      {f.pms.filter((p) => p.fecha_programada === d).map(tarjetaPm)}
                      {f.items
                        .filter((b) => b.fecha_programada === d)
                        .map((b) => (
                          <div
                            key={b.id}
                            className={`tarjeta-cal${b.estado !== "Programado" ? " hecha" : ""}${b.tipo_pedido === "Urgente" ? " urgente" : ""}`}
                            aria-label={`${b.folio} ${b.cod_interno}`}
                            {...arrastre(b)}
                          >
                            <Link to={`/backlog/${b.id}`} className="tc-folio" draggable={false}>
                              {b.folio}
                            </Link>
                            <div className="tc-trabajo">{b.descripcion}</div>
                            <div className="tc-datos">
                              <span>{fNum(b.hh_estimadas)} HH</span>
                              {b.ot_sap && <span>{b.ot_sap.startsWith("OT") ? b.ot_sap : `OT ${b.ot_sap}`}</span>}
                              {(b.aprovechar_pm || conPm.has(`${b.equipo_id}|${d}`)) && <span className="tc-pm">con PM</span>}
                              {b.estado !== "Programado" && <span>{b.estado}</span>}
                            </div>
                          </div>
                        ))}
                      {(f.items.some((b) => b.fecha_programada === d) || f.pms.some((p) => p.fecha_programada === d)) && (
                        <button
                          className="boton-plano boton-paquete"
                          aria-label={`Paquete ${f.cod} ${fFecha(d)}`}
                          title="Ver e imprimir el paquete de órdenes de este equipo y día"
                          onClick={() => setPaquete({ equipo_id: equipoId, fecha: d })}
                        >
                          Paquete
                        </button>
                      )}
                      {puedeCapturar && (
                        <button
                          className="boton-plano boton-pm-celda"
                          aria-label={`Programar preventivo ${f.cod} ${fFecha(d)}`}
                          title="Programar un preventivo para este equipo y día"
                          onClick={() => pm.programar({ equipo_id: equipoId, fecha: d })}
                        >
                          + PM
                        </button>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
              {filas.length === 0 && (
                <tr>
                  <td className="col-equipo nota">Sin trabajos</td>
                  {dias.map((d) => (
                    <td key={d} className={`celda-vacia ${claseDia(d)}`} {...zonaDia(d)}>
                      {admiteSoltar(d) ? "Soltar aquí" : ""}
                    </td>
                  ))}
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td className="col-equipo">Total HH</td>
                {dias.map((d) => (
                  <td key={d} className="num">
                    {totalDia(d) ? fNum(totalDia(d)) : ""}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
      {/* Celular: lista por día (el CSS oculta la grilla y muestra esto). Se programa desde la ficha. */}
      <div className="dias-movil">
        {listos.length > 0 && (
          <details className="listos-movil">
            <summary>Listos para programar ({listos.length})</summary>
            <div className="lista-dia">
              {listos.map((b) => (
                <Link key={b.id} to={`/backlog/${b.id}`} className={`tarjeta-cal listo${b.vencido ? " vencida" : ""}`}>
                  <div className="tc-linea1">
                    <span className="tc-folio">{b.folio}</span>
                    {b.tipo_pedido === "Urgente" && <span className="etiqueta-urgente">Urgente</span>}
                    <EtiquetaPrioridad prioridad={b.prioridad} />
                  </div>
                  <div className="tc-equipo">{b.cod_interno}</div>
                  <div className="tc-trabajo">{b.descripcion}</div>
                  <div className="tc-datos">
                    <span>{fNum(b.hh_estimadas)} HH</span>
                    <span className={b.vencido ? "texto-vencido" : undefined}>límite {fFecha(b.fecha_limite)}</span>
                  </div>
                </Link>
              ))}
            </div>
          </details>
        )}
        {dias.map((d, i) => {
          const del_dia = semana.filter((b) => b.fecha_programada === d).sort((a, b) => a.cod_interno.localeCompare(b.cod_interno));
          const pm_dia = pmSemana.filter((p) => p.fecha_programada === d).sort((a, b) => a.cod_interno.localeCompare(b.cod_interno));
          return (
            <section key={d} className={`dia-movil${d === hoy ? " hoy" : ""}${d < hoy ? " pasado" : ""}`} aria-label={`Día ${fFecha(d)}`}>
              <header>
                <span>
                  {DIAS[i]} {fFecha(d)}
                </span>
                <span>{del_dia.length ? `${fNum(totalDia(d))} HH` : ""}</span>
                {puedeCapturar && clavesDia(d).length > 0 && (
                  <button className="boton-plano boton-paquetes-movil" disabled={paquetes.ocupado} onClick={() => paquetes.imprimir(clavesDia(d))}>
                    Paquetes ({clavesDia(d).length})
                  </button>
                )}
              </header>
              <div className="lista-dia">
                {del_dia.length === 0 && pm_dia.length === 0 && <span className="nota">Sin trabajos</span>}
                {pm_dia.map((p) => (
                  <Link key={p.id} to={`/preventivo/${p.id}`} className={`tarjeta-cal pm${p.estado === "Ejecutado" ? " hecha" : ""}`}>
                    <div className="tc-linea1">
                      <span className="tc-folio">{p.folio}</span>
                      <b>{p.cod_interno}</b>
                      <span className="etiqueta-pm">PM</span>
                    </div>
                    <div className="tc-trabajo">{p.actividad}</div>
                    <div className="tc-datos">
                      <span>{p.n_ot.startsWith("OT") ? p.n_ot : `OT ${p.n_ot}`}</span>
                      {p.estado !== "Programado" && <span>{p.estado}</span>}
                    </div>
                  </Link>
                ))}
                {del_dia.map((b) => (
                  <Link
                    key={b.id}
                    to={`/backlog/${b.id}`}
                    className={`tarjeta-cal${b.estado !== "Programado" ? " hecha" : ""}${b.tipo_pedido === "Urgente" ? " urgente" : ""}`}
                  >
                    <div className="tc-linea1">
                      <span className="tc-folio">{b.folio}</span>
                      <b>{b.cod_interno}</b>
                    </div>
                    <div className="tc-trabajo">{b.descripcion}</div>
                    <div className="tc-datos">
                      <span>{fNum(b.hh_estimadas)} HH</span>
                      {b.ot_sap && <span>{b.ot_sap.startsWith("OT") ? b.ot_sap : `OT ${b.ot_sap}`}</span>}
                      {(b.aprovechar_pm || conPm.has(`${b.equipo_id}|${d}`)) && <span className="tc-pm">con PM</span>}
                      {b.estado !== "Programado" && <span>{b.estado}</span>}
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
      </div>
      {isLoading && <p className="nota">Cargando…</p>}
      {cambio.dialogo}
      {pm.dialogo}
      {paquete && <DialogoPaquete clave={paquete} puedeImprimir={puedeCapturar} onCerrar={() => setPaquete(null)} />}
    </div>
  );
}
