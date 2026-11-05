import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { useBacklogs, useEquipos } from "../lib/queries";
import { EtiquetaEstado, EtiquetaPrioridad } from "../components/Etiquetas";
import { ESTADOS_ABIERTOS } from "../lib/types";
import { fFecha, fNum } from "../lib/fmt";

// Historial de backlogs de un equipo y HH por sistema.
export default function FichaEquipo() {
  const { id = "" } = useParams();
  const { data: equipos, isLoading } = useEquipos();
  const { data: backlogs } = useBacklogs();
  const equipo = equipos?.find((e) => e.id === id);

  const lista = useMemo(
    () => (backlogs ?? []).filter((b) => b.equipo_id === id).sort((a, b) => b.fecha_deteccion.localeCompare(a.fecha_deteccion) || b.folio.localeCompare(a.folio)),
    [backlogs, id]
  );
  const porSistema = useMemo(() => {
    const m = new Map<string, { abiertos: number; hhPend: number; cerrados: number; hhReal: number }>();
    for (const b of lista) {
      if (b.estado === "Rechazado" || b.estado === "Anulado") continue;
      const x = m.get(b.sistema) ?? { abiertos: 0, hhPend: 0, cerrados: 0, hhReal: 0 };
      if (ESTADOS_ABIERTOS.includes(b.estado)) {
        x.abiertos++;
        x.hhPend += Number(b.hh_estimadas);
      } else {
        x.cerrados++;
        x.hhReal += Number(b.hh_reales);
      }
      m.set(b.sistema, x);
    }
    return [...m.entries()].sort((a, b) => b[1].hhPend - a[1].hhPend || b[1].hhReal - a[1].hhReal);
  }, [lista]);

  if (isLoading) return <p className="nota">Cargando…</p>;
  if (!equipo)
    return (
      <div>
        <h1>Equipo no encontrado</h1>
        <p className="nota">No existe o es de otra unidad. <Link to="/flota">Volver</Link></p>
      </div>
    );

  return (
    <div>
      <p className="nota"><Link to="/flota">Por equipo</Link> / {equipo.flota ?? "Sin flota"}</p>
      <h1>{equipo.cod_interno}</h1>
      <p className="subtitulo">
        {[equipo.flota, equipo.marca, equipo.modelo].filter(Boolean).join(" · ")}
        {equipo.cod_sap ? ` · SAP ${equipo.cod_sap}` : ""}
      </p>

      <div className="bloque-ficha">
        <h2>HH por sistema</h2>
        {porSistema.length === 0 ? (
          <p className="nota">Sin backlogs.</p>
        ) : (
          <div className="tabla-marco">
            <table>
              <thead>
                <tr>
                  <th>Sistema</th>
                  <th className="num">Abiertos</th>
                  <th className="num">HH pendientes</th>
                  <th className="num">Ejecutados</th>
                  <th className="num">HH reales</th>
                </tr>
              </thead>
              <tbody>
                {porSistema.map(([s, x]) => (
                  <tr key={s}>
                    <td>{s}</td>
                    <td className="num">{x.abiertos}</td>
                    <td className="num">{fNum(x.hhPend)}</td>
                    <td className="num">{x.cerrados}</td>
                    <td className="num">{fNum(x.hhReal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bloque-ficha">
        <h2>Backlogs ({lista.length})</h2>
        <div className="tabla-marco">
          <table>
            <thead>
              <tr>
                <th>Folio</th>
                <th>Detección</th>
                <th>Trabajo</th>
                <th>Sistema</th>
                <th>Prioridad</th>
                <th>Estado</th>
                <th className="num">HH est.</th>
                <th className="num">HH real</th>
                <th>Ejecutado</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((b) => (
                <tr key={b.id}>
                  <td><Link to={`/backlog/${b.id}`}>{b.folio}</Link></td>
                  <td>{fFecha(b.fecha_deteccion)}</td>
                  <td>
                    {b.descripcion}
                    {b.componente && <span className="nota"> · {b.componente}</span>}
                  </td>
                  <td>{b.sistema}</td>
                  <td><EtiquetaPrioridad prioridad={b.prioridad} /></td>
                  <td><EtiquetaEstado estado={b.estado} /></td>
                  <td className="num">{fNum(b.hh_estimadas)}</td>
                  <td className="num">{fNum(b.hh_reales)}</td>
                  <td>{fFecha(b.fecha_ejecucion)}</td>
                </tr>
              ))}
              {lista.length === 0 && (
                <tr><td colSpan={9} className="nota">Este equipo no tiene backlogs.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
