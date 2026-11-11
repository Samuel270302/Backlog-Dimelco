import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth";
import { ETIQUETA_ACCION, accionesPreventivo, usePreventivos } from "../lib/preventivos";
import { useAccionesPreventivo } from "../components/preventivos/AccionesPreventivo";
import { EtiquetaEstadoPreventivo } from "../components/preventivos/EtiquetaEstadoPreventivo";
import { fFecha, hoyISO } from "../lib/fmt";
import type { EstadoPreventivo } from "../lib/types";

type Filtro = "Programado" | "Ejecutado" | "Anulado" | "Todos";

// Preventivos programados a mano: se programan, se ejecutan con sus materiales y
// entran al paquete del equipo y día. Las pautas y los kits van fuera de la app.
export default function Preventivos() {
  const { esAdmin, puedeCapturar } = useAuth();
  const { data: preventivos, isLoading } = usePreventivos();
  const acciones = useAccionesPreventivo();
  const [filtro, setFiltro] = useState<Filtro>("Programado");
  const [buscar, setBuscar] = useState("");
  const hoy = hoyISO();

  const lista = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    return (preventivos ?? [])
      .filter((p) => filtro === "Todos" || p.estado === filtro)
      .filter((p) => !q || `${p.folio} ${p.n_ot} ${p.cod_interno} ${p.modelo} ${p.actividad}`.toLowerCase().includes(q))
      .sort((a, b) =>
        filtro === "Programado"
          ? a.fecha_programada.localeCompare(b.fecha_programada) || a.cod_interno.localeCompare(b.cod_interno)
          : (b.fecha_ejecucion ?? b.fecha_programada).localeCompare(a.fecha_ejecucion ?? a.fecha_programada)
      );
  }, [preventivos, filtro, buscar]);
  const cuenta = (e: EstadoPreventivo) => (preventivos ?? []).filter((p) => p.estado === e).length;

  return (
    <div className="pagina-formulario formato pagina-preventivos">
      <div className="barra-acciones">
        <h1 style={{ margin: 0 }}>Preventivos</h1>
        <div className="espacio" />
        {puedeCapturar && <button onClick={() => acciones.programar()}>Programar preventivo</button>}
      </div>
      <p className="subtitulo">
        Se programan a mano y se cierran aquí con los materiales utilizados. No suman horas hombre a la carga del taller. La pauta
        de mantenimiento y el listado de filtros se imprimen aparte.
      </p>
      <div className="barra-acciones">
        <select aria-label="Estado de los preventivos" value={filtro} onChange={(e) => setFiltro(e.target.value as Filtro)}>
          <option value="Programado">Programados ({cuenta("Programado")})</option>
          <option value="Ejecutado">Ejecutados ({cuenta("Ejecutado")})</option>
          <option value="Anulado">Anulados ({cuenta("Anulado")})</option>
          <option value="Todos">Todos ({preventivos?.length ?? 0})</option>
        </select>
        <input
          type="search"
          value={buscar}
          onChange={(e) => setBuscar(e.target.value)}
          placeholder="Buscar por equipo, actividad, folio u OT"
          aria-label="Buscar preventivos"
          style={{ minWidth: 260 }}
        />
      </div>
      {isLoading ? (
        <p className="nota">Cargando…</p>
      ) : lista.length === 0 ? (
        <p className="nota">No hay preventivos {filtro === "Todos" ? "" : `en estado ${filtro}`}.</p>
      ) : (
        <div className="tabla-marco">
          <table className="tabla-edicion tabla-preventivos">
            <thead>
              <tr>
                <th>Folio</th>
                <th>N° OT</th>
                <th>Equipo</th>
                <th>Actividad</th>
                <th>Programado</th>
                <th>Ejecutado</th>
                <th>Estado</th>
                <th className="num">Materiales</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lista.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link to={`/preventivo/${p.id}`}>{p.folio}</Link>
                  </td>
                  <td>{p.n_ot}</td>
                  <td>
                    <b>{p.cod_interno}</b>
                    <div className="nota">{p.modelo}</div>
                  </td>
                  <td>{p.actividad}</td>
                  <td className={p.estado === "Programado" && p.fecha_programada < hoy ? "texto-vencido" : undefined}>
                    {fFecha(p.fecha_programada)}
                    {p.reprogramaciones > 0 && <div className="nota">{p.reprogramaciones} reprog.</div>}
                  </td>
                  <td>{fFecha(p.fecha_ejecucion)}</td>
                  <td>
                    <EtiquetaEstadoPreventivo estado={p.estado} />
                  </td>
                  <td className="num">{p.materiales_total || ""}</td>
                  <td className="celda-acciones">
                    {accionesPreventivo(p.estado, esAdmin, puedeCapturar).map((a) => (
                      <button
                        key={a}
                        className={a === "ejecutar" ? undefined : a === "anular" ? "boton-plano boton-peligro-plano" : "boton-plano"}
                        aria-label={`${ETIQUETA_ACCION[a]} ${p.folio}`}
                        onClick={() => acciones.abrir(p, a)}
                      >
                        {ETIQUETA_ACCION[a]}
                      </button>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {acciones.dialogo}
    </div>
  );
}
