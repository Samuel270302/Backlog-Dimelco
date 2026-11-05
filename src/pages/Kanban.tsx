import { useMemo, useState } from "react";
import { useBacklogs, useEspecialidades } from "../lib/queries";
import { useDetalleBacklogs, claseEstado } from "../lib/backlog";
import { useCambioEstado, useTransicionesPermitidas } from "../components/CambioEstado";
import TarjetaBacklog from "../components/TarjetaBacklog";
import { PRIORIDADES, TIPOS_PEDIDO, type BacklogFila, type Estado } from "../lib/types";
import { fNum } from "../lib/fmt";

const COLUMNAS: Estado[] = [
  "Identificado",
  "En planificación",
  "Esperando repuestos",
  "Listo para programar",
  "Programado",
  "Ejecutado",
  "Cerrado",
];
const DIAS_CERRADOS = 7;

const ordenTarjetas = (a: BacklogFila, b: BacklogFila) =>
  Number(b.tipo_pedido === "Urgente") - Number(a.tipo_pedido === "Urgente") ||
  a.prioridad.localeCompare(b.prioridad) ||
  (a.dias_para_limite ?? 9999) - (b.dias_para_limite ?? 9999) ||
  a.folio.localeCompare(b.folio);

export default function Kanban() {
  const { data: backlogs, isLoading } = useBacklogs();
  const { data: especialidades } = useEspecialidades();
  const permitidas = useTransicionesPermitidas();
  const cambio = useCambioEstado();
  const [buscar, setBuscar] = useState("");
  const [flota, setFlota] = useState("");
  const [prioridad, setPrioridad] = useState("");
  const [tipoPedido, setTipoPedido] = useState("");
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set());
  const [arrastrando, setArrastrando] = useState<BacklogFila | null>(null);
  const [sobre, setSobre] = useState<Estado | null>(null);

  const flotas = useMemo(
    () => [...new Set((backlogs ?? []).map((b) => b.flota).filter((f): f is string => !!f))].sort(),
    [backlogs]
  );

  const visibles = useMemo(() => {
    const limiteCerrados = Date.now() - DIAS_CERRADOS * 86400000;
    const t = buscar.trim().toLowerCase();
    return (backlogs ?? [])
      .filter((b) => COLUMNAS.includes(b.estado))
      .filter((b) => b.estado !== "Cerrado" || new Date(b.actualizado_en).getTime() >= limiteCerrados)
      .filter((b) => !flota || b.flota === flota)
      .filter((b) => !prioridad || b.prioridad === prioridad)
      .filter((b) => !tipoPedido || b.tipo_pedido === tipoPedido)
      .filter(
        (b) =>
          !t ||
          `${b.folio} ${b.cod_interno} ${b.descripcion} ${b.componente ?? ""} ${b.ot_sap ?? ""}`.toLowerCase().includes(t)
      );
  }, [backlogs, buscar, flota, prioridad, tipoPedido]);

  const { data: detalle } = useDetalleBacklogs(visibles.map((b) => b.id));

  const transicionHacia = (b: BacklogFila, destino: Estado) => permitidas(b.estado).find((t) => t.destino === destino);

  function alternar(id: string) {
    setAbiertas((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  return (
    <div className="pagina-kanban">
      <div className="barra-acciones">
        <h1 style={{ margin: 0 }}>Kanban</h1>
        <div className="espacio" />
        <input
          className="filtro-buscar"
          placeholder="Buscar folio, equipo, trabajo, OT"
          value={buscar}
          onChange={(e) => setBuscar(e.target.value)}
          aria-label="Buscar"
        />
        <select value={flota} onChange={(e) => setFlota(e.target.value)} aria-label="Flota">
          <option value="">Todas las flotas</option>
          {flotas.map((f) => (
            <option key={f}>{f}</option>
          ))}
        </select>
        <select value={prioridad} onChange={(e) => setPrioridad(e.target.value)} aria-label="Prioridad">
          <option value="">Toda prioridad</option>
          {PRIORIDADES.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <select value={tipoPedido} onChange={(e) => setTipoPedido(e.target.value)} aria-label="Tipo de pedido">
          <option value="">Normal y urgente</option>
          {TIPOS_PEDIDO.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <button className="boton-plano" onClick={() => setAbiertas(abiertas.size ? new Set() : new Set(visibles.map((b) => b.id)))}>
          {abiertas.size ? "Cerrar todas" : "Abrir todas"}
        </button>
      </div>

      {isLoading ? (
        <p className="nota">Cargando…</p>
      ) : (
        <div className="kanban">
          {COLUMNAS.map((col) => {
            const tarjetas = visibles.filter((b) => b.estado === col).sort(ordenTarjetas);
            const hh = tarjetas.reduce((s, b) => s + Number(b.hh_estimadas), 0);
            const admite = arrastrando ? !!transicionHacia(arrastrando, col) : false;
            return (
              <section
                key={col}
                className={`columna-kanban${arrastrando && admite ? " admite" : ""}${sobre === col && admite ? " sobre" : ""}${arrastrando && !admite && arrastrando.estado !== col ? " no-admite" : ""}`}
                aria-label={col}
                onDragOver={(e) => {
                  if (!admite) return;
                  e.preventDefault();
                  setSobre(col);
                }}
                onDragLeave={() => setSobre((s) => (s === col ? null : s))}
                onDrop={(e) => {
                  e.preventDefault();
                  const b = arrastrando;
                  setArrastrando(null);
                  setSobre(null);
                  if (!b) return;
                  const t = transicionHacia(b, col);
                  if (t) cambio.abrir(b, t);
                }}
              >
                <header className={`columna-cabecera ${claseEstado(col)}`}>
                  <span>{col === "Cerrado" ? `Cerrado (${DIAS_CERRADOS} días)` : col}</span>
                  <span className="columna-cuenta">
                    {tarjetas.length} · {fNum(hh)} HH
                  </span>
                </header>
                <div
                  className="columna-tarjetas"
                  onDragEnd={() => {
                    setArrastrando(null);
                    setSobre(null);
                  }}
                >
                  {tarjetas.map((b) => (
                    <TarjetaBacklog
                      key={b.id}
                      b={b}
                      repuestos={detalle?.repuestos.get(b.id) ?? []}
                      hh={detalle?.hh.get(b.id) ?? []}
                      especialidades={especialidades ?? []}
                      abierta={abiertas.has(b.id)}
                      onAlternar={() => alternar(b.id)}
                      acciones={permitidas(b.estado)}
                      onAccion={(t) => cambio.abrir(b, t)}
                      arrastrable={permitidas(b.estado).length > 0}
                      onArrastrar={() => setArrastrando(b)}
                    />
                  ))}
                  {tarjetas.length === 0 && <p className="nota columna-vacia">Sin backlogs</p>}
                </div>
              </section>
            );
          })}
        </div>
      )}
      {cambio.dialogo}
    </div>
  );
}
