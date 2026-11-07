import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth";
import { useBacklogs, useCapacidadVigente, useEspecialidades } from "../lib/queries";
import { lunesDe, useDetalleBacklogs } from "../lib/backlog";
import { useCambioEstado, useTransicionesPermitidas } from "../components/CambioEstado";
import { EtiquetaPrioridad } from "../components/Etiquetas";
import { fFecha, fNum, hoyISO, sumarDiasISO } from "../lib/fmt";
import type { BacklogFila } from "../lib/types";

// Programa semanal: backlogs programados por equipo y día, panel de listos para
// programar y carga de HH por especialidad contra la capacidad del taller.
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
  const [arrastrando, setArrastrando] = useState<BacklogFila | null>(null);
  const [sobreDia, setSobreDia] = useState<string | null>(null);

  const semana = useMemo(
    () =>
      (backlogs ?? []).filter(
        (b) => EN_CALENDARIO.includes(b.estado) && b.fecha_programada && b.fecha_programada >= lunes && b.fecha_programada <= domingo
      ),
    [backlogs, lunes, domingo]
  );
  const listos = useMemo(() => (backlogs ?? []).filter((b) => b.estado === "Listo para programar").sort(ordenListos), [backlogs]);
  const { data: detalle } = useDetalleBacklogs(semana.map((b) => b.id));

  const filas = useMemo(() => {
    const m = new Map<string, { cod: string; modelo: string; items: BacklogFila[] }>();
    for (const b of semana) {
      const f = m.get(b.equipo_id) ?? { cod: b.cod_interno, modelo: b.modelo, items: [] };
      f.items.push(b);
      m.set(b.equipo_id, f);
    }
    return [...m.entries()].sort((a, b) => a[1].cod.localeCompare(b[1].cod));
  }, [semana]);

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

  const totalDia = (d: string) =>
    semana.filter((b) => b.fecha_programada === d).reduce((s, b) => s + Number(b.hh_estimadas), 0);

  // Transición que corresponde al soltar en un día: programar un listo o reprogramar un programado.
  function transicionAlSoltar(b: BacklogFila, dia: string) {
    if (dia < hoy) return undefined;
    if (b.estado === "Listo para programar") return permitidas(b.estado).find((t) => t.destino === "Programado");
    if (b.estado === "Programado" && b.fecha_programada !== dia)
      return permitidas(b.estado).find((t) => t.etiqueta === "Reprogramar");
    return undefined;
  }

  const zonaDia = (dia: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!arrastrando || !transicionAlSoltar(arrastrando, dia)) return;
      e.preventDefault();
      setSobreDia(dia);
    },
    onDragLeave: () => setSobreDia((d) => (d === dia ? null : d)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      const b = arrastrando;
      setArrastrando(null);
      setSobreDia(null);
      if (!b) return;
      const t = transicionAlSoltar(b, dia);
      if (t) cambio.abrir(b, t, dia);
    },
  });
  const claseDia = (dia: string) =>
    [
      dia === hoy ? "hoy" : "",
      dia < hoy ? "pasado" : "",
      arrastrando && transicionAlSoltar(arrastrando, dia) ? "admite" : "",
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

  return (
    <div className="pagina-calendario">
      <div className="barra-acciones">
        <h1 style={{ margin: 0 }}>Calendario</h1>
        <span className="semana-titulo">
          Semana del {fFecha(lunes)} al {fFecha(domingo)}
        </span>
        <div className="espacio" />
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
                              {b.ot_sap && <span>OT {b.ot_sap}</span>}
                              {b.aprovechar_pm && <span className="tc-pm">con PM</span>}
                              {b.estado !== "Programado" && <span>{b.estado}</span>}
                            </div>
                          </div>
                        ))}
                    </td>
                  ))}
                </tr>
              ))}
              {filas.length === 0 && (
                <tr>
                  <td className="col-equipo nota">Sin trabajos</td>
                  {dias.map((d) => (
                    <td key={d} className={`celda-vacia ${claseDia(d)}`} {...zonaDia(d)}>
                      {puedeCapturar && listos.length > 0 && d >= hoy ? "Soltar aquí" : ""}
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
          return (
            <section key={d} className={`dia-movil${d === hoy ? " hoy" : ""}${d < hoy ? " pasado" : ""}`} aria-label={`Día ${fFecha(d)}`}>
              <header>
                <span>
                  {DIAS[i]} {fFecha(d)}
                </span>
                <span>{del_dia.length ? `${fNum(totalDia(d))} HH` : ""}</span>
              </header>
              <div className="lista-dia">
                {del_dia.length === 0 && <span className="nota">Sin trabajos</span>}
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
                      {b.ot_sap && <span>OT {b.ot_sap}</span>}
                      {b.aprovechar_pm && <span className="tc-pm">con PM</span>}
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
    </div>
  );
}
