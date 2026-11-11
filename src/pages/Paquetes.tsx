import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth";
import { usePaquetes } from "../lib/paquete";
import { DialogoPaquete, type ClavePaquete } from "../components/paquetes/Paquetes";
import { fFecha, fFechaHora } from "../lib/fmt";

// Paquetes de órdenes de trabajo ya numerados: un equipo y un día. Se arman desde el
// calendario; aquí se consultan y se vuelven a imprimir.
export default function Paquetes() {
  const { puedeCapturar } = useAuth();
  const { data: paquetes, isLoading } = usePaquetes();
  const [abierto, setAbierto] = useState<ClavePaquete | null>(null);
  const lista = [...(paquetes ?? [])].sort((a, b) => b.fecha.localeCompare(a.fecha) || a.cod_interno.localeCompare(b.cod_interno));

  return (
    <div className="pagina-formulario formato">
      <h1>Paquetes de órdenes de trabajo</h1>
      <p className="subtitulo">
        Un paquete reúne los preventivos y correctivos programados para un equipo en un día. Se arma en el <Link to="/calendario">Calendario</Link>,
        con el botón Paquete de cada celda. Si una orden se reprograma, sale sola del paquete.
      </p>
      {isLoading ? (
        <p className="nota">Cargando…</p>
      ) : lista.length === 0 ? (
        <p className="nota">Todavía no se imprimió ningún paquete.</p>
      ) : (
        <div className="tabla-marco">
          <table className="tabla-edicion tabla-paquetes">
            <thead>
              <tr>
                <th>N° de paquete</th>
                <th>Fecha</th>
                <th>Equipo</th>
                <th className="num">Preventivos</th>
                <th className="num">Correctivos</th>
                <th>Avance</th>
                <th>Última impresión</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lista.map((q) => {
                const total = q.preventivos + q.correctivos;
                const hechas = q.preventivos_ejecutados + q.correctivos_ejecutados;
                return (
                  <tr key={q.id}>
                    <td><b>{q.folio}</b></td>
                    <td>{fFecha(q.fecha)}</td>
                    <td>
                      <Link to={`/equipo/${q.equipo_id}`}>{q.cod_interno}</Link>
                      <div className="nota">{q.modelo}</div>
                    </td>
                    <td className="num">{q.preventivos || ""}</td>
                    <td className="num">{q.correctivos || ""}</td>
                    <td>{total === 0 ? <span className="nota">Sin órdenes (se reprogramaron)</span> : `${hechas} de ${total} ejecutadas`}</td>
                    <td>
                      {fFechaHora(q.impreso_en)}
                      {q.impresiones > 1 && <div className="nota">{q.impresiones} impresiones</div>}
                    </td>
                    <td>
                      <button className="boton-plano" disabled={total === 0} aria-label={`Ver ${q.folio}`} onClick={() => setAbierto({ equipo_id: q.equipo_id, fecha: q.fecha })}>
                        {puedeCapturar ? "Ver e imprimir" : "Ver"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {abierto && <DialogoPaquete clave={abierto} puedeImprimir={puedeCapturar} onCerrar={() => setAbierto(null)} />}
    </div>
  );
}
