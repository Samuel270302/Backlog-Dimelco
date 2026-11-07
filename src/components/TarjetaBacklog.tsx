import { Link } from "react-router-dom";
import { fFecha, fNum } from "../lib/fmt";
import type { Transicion } from "../lib/backlog";
import type { BacklogEvento, BacklogFila, BacklogHh, BacklogRepuesto, Catalogo } from "../lib/types";
import { EtiquetaPrioridad } from "./Etiquetas";
import BarraAvance, { subestadoPlaneado } from "./BarraAvance";
import { useFotosBacklog } from "../lib/fotos";

// Tarjeta del Kanban. Cerrada: lo necesario para decidir. Abierta (clic): el detalle del
// formato (equipo, componente, repuestos, especialidades con HH, justificación) y las
// acciones de estado, sin salir del tablero.
export default function TarjetaBacklog({
  b,
  repuestos,
  hh,
  eventos = [],
  especialidades,
  abierta,
  onAlternar,
  acciones,
  onAccion,
  arrastrable,
  onArrastrar,
}: {
  b: BacklogFila;
  repuestos: BacklogRepuesto[];
  hh: BacklogHh[];
  eventos?: BacklogEvento[];
  especialidades: Catalogo[];
  abierta: boolean;
  onAlternar: () => void;
  acciones: Transicion[];
  onAccion: (t: Transicion) => void;
  arrastrable: boolean;
  onArrastrar?: () => void;
}) {
  const recibidos = repuestos.filter((r) => r.estado === "Recibido").length;
  const estimadas = hh.filter((h) => h.tipo === "estimada");
  const reales = hh.filter((h) => h.tipo === "real");
  const nombreEsp = (id: string) => especialidades.find((e) => e.id === id)?.nombre ?? "";
  const ordenados = [...repuestos].sort((a, c) => a.item - c.item);

  return (
    <article
      className={`tarjeta-kanban${abierta ? " abierta" : ""}${b.vencido ? " vencida" : ""}${b.tipo_pedido === "Urgente" ? " urgente" : ""}`}
      draggable={arrastrable}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", b.id);
        e.dataTransfer.effectAllowed = "move";
        onArrastrar?.();
      }}
      aria-label={`${b.folio} ${b.cod_interno}`}
    >
      <button className="tk-cabecera" onClick={onAlternar} aria-expanded={abierta}>
        <span className="tk-linea1">
          <span className="tk-folio">{b.folio}</span>
          {b.tipo_pedido === "Urgente" && <span className="etiqueta-urgente">Urgente</span>}
          <EtiquetaPrioridad prioridad={b.prioridad} />
        </span>
        <BarraAvance b={b} />
        {subestadoPlaneado(b) && <span className="tk-subestado">{subestadoPlaneado(b)}</span>}
        <span className="tk-equipo">{b.cod_interno}{b.componente ? ` · ${b.componente}` : ""}</span>
        <span className="tk-descripcion">{b.descripcion}</span>
        <span className="tk-datos">
          <span title="HH estimadas">{fNum(b.hh_estimadas)} HH</span>
          <span title="Días desde la detección" className={b.vencido ? "texto-vencido" : undefined}>
            {b.antiguedad_dias} d{b.vencido ? " · vencido" : ""}
          </span>
          {b.repuestos_total > 0 && (
            <span title="Repuestos recibidos / total">
              Rep. {b.repuestos_total - b.repuestos_pendientes}/{b.repuestos_total}
            </span>
          )}
          {b.fecha_programada && <span title="Fecha programada">{fFecha(b.fecha_programada)}</span>}
        </span>
      </button>

      {abierta && (
        <div
          className="tk-detalle"
          draggable={arrastrable}
          onDragStart={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <BarraAvance b={b} eventos={eventos} detallada />
          <dl className="tk-ficha">
            <div><dt>Equipo</dt><dd>{[b.flota, b.marca, b.modelo].filter(Boolean).join(" · ")}</dd></div>
            <div><dt>Sistema</dt><dd>{b.sistema}</dd></div>
            {b.horometro !== null && <div><dt>Horómetro</dt><dd>{fNum(b.horometro)} h</dd></div>}
            <div><dt>Reportado por</dt><dd>{b.reportado_por ?? "—"}</dd></div>
            {b.aprobado_por && <div><dt>Aprobado por</dt><dd>{b.aprobado_por}</dd></div>}
            <div><dt>Fecha límite</dt><dd className={b.vencido ? "texto-vencido" : undefined}>{fFecha(b.fecha_limite)}</dd></div>
            {b.ot_sap && <div><dt>{b.usa_sap ? "OT SAP" : "N° OT"}</dt><dd>{b.ot_sap}</dd></div>}
          </dl>

          <div className="tk-seccion">Repuestos {ordenados.length > 0 && `(${recibidos}/${ordenados.length} recibidos)`}</div>
          {ordenados.length === 0 ? (
            <p className="nota">Sin repuestos.</p>
          ) : (
            <table className="tk-tabla">
              <thead>
                <tr>
                  <th>N° parte / código</th>
                  <th className="num">Cant</th>
                  <th className="num">Stock</th>
                  <th>Descripción</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {ordenados.map((r) => (
                  <tr key={r.id} className={r.estado === "Recibido" ? "fila-recibida" : undefined}>
                    <td>{[r.numero_parte, r.cod_sap].filter(Boolean).join(" / ")}</td>
                    <td className="num">{fNum(r.cantidad, 2)}</td>
                    <td className="num">{fNum(r.stock, 2)}</td>
                    <td>{r.descripcion}</td>
                    <td>{r.estado}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="tk-seccion">Especialidades y HH</div>
          {estimadas.length === 0 && reales.length === 0 ? (
            <p className="nota">Sin HH cargadas.</p>
          ) : (
            <table className="tk-tabla">
              <thead>
                <tr>
                  <th>Especialidad</th>
                  <th className="num">Estimadas</th>
                  {reales.length > 0 && <th className="num">Reales</th>}
                </tr>
              </thead>
              <tbody>
                {[...new Set([...estimadas, ...reales].map((h) => h.especialidad_id))].map((id) => {
                  const est = estimadas.find((h) => h.especialidad_id === id);
                  const real = reales.find((h) => h.especialidad_id === id);
                  return (
                    <tr key={id}>
                      <td>{nombreEsp(id)}</td>
                      <td className="num">{est ? `${fNum(est.personas)} × ${fNum(est.horas)} = ${fNum(est.hh)}` : "—"}</td>
                      {reales.length > 0 && <td className="num">{real ? fNum(real.hh) : "—"}</td>}
                    </tr>
                  );
                })}
                <tr className="tk-total">
                  <td>Total</td>
                  <td className="num">{fNum(b.hh_estimadas)}</td>
                  {reales.length > 0 && <td className="num">{fNum(b.hh_reales)}</td>}
                </tr>
              </tbody>
            </table>
          )}

          {b.justificacion && (
            <>
              <div className="tk-seccion">Justificación</div>
              <p className="tk-texto">{b.justificacion}</p>
            </>
          )}

          <MiniaturasTarjeta id={b.id} />
          <div className="tk-acciones">
            {acciones.map((t) => (
              <button
                key={t.destino}
                className={t.peligro ? "boton-plano boton-peligro-plano" : t.atras ? "boton-secundario boton-chico" : "boton-chico"}
                onClick={() => onAccion(t)}
              >
                {t.etiqueta}
              </button>
            ))}
            <Link className="enlace-ficha" to={`/backlog/${b.id}`}>
              Abrir ficha
            </Link>
          </div>
        </div>
      )}
    </article>
  );
}

// Hasta 3 miniaturas; se piden solo cuando la tarjeta está desplegada.
function MiniaturasTarjeta({ id }: { id: string }) {
  const { data: fotos } = useFotosBacklog(id);
  const con = (fotos ?? []).filter((f) => f.url);
  if (!con.length) return null;
  return (
    <div className="tk-fotos">
      {con.slice(0, 3).map((f) => (
        <img key={f.id} src={f.url!} alt="Foto del backlog" loading="lazy" />
      ))}
      {con.length > 3 && <span className="nota">+{con.length - 3}</span>}
    </div>
  );
}
