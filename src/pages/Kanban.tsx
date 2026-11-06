import { useMemo, useRef, useState } from "react";
import { useEsMovil } from "../lib/movil";
import { useBacklogs, useEspecialidades } from "../lib/queries";
import { useDetalleBacklogs } from "../lib/backlog";
import { useCambioEstado, useTransicionesPermitidas } from "../components/CambioEstado";
import TarjetaBacklog from "../components/TarjetaBacklog";
import { ESTADOS_PLANEADO, PRIORIDADES, nombrePrioridad, TIPOS_PEDIDO, type BacklogFila, type Estado, type Etapa } from "../lib/types";
import { fNum } from "../lib/fmt";

// Kanban por etapa: Identificado, Planeado (planificación, esperando repuestos y
// listo para programar), Programado, Ejecutado y Validado (últimos 7 días).
const COLUMNAS: { etapa: Etapa; estados: Estado[] }[] = [
  { etapa: "Identificado", estados: ["Identificado"] },
  { etapa: "Planeado", estados: ESTADOS_PLANEADO },
  { etapa: "Programado", estados: ["Programado"] },
  { etapa: "Ejecutado", estados: ["Ejecutado"] },
  { etapa: "Validado", estados: ["Validado"] },
];
const DIAS_VALIDADOS = 7;
const TODOS = COLUMNAS.flatMap((c) => c.estados);

const ordenTarjetas = (a: BacklogFila, b: BacklogFila) =>
  TODOS.indexOf(b.estado) - TODOS.indexOf(a.estado) || // en Planeado, primero los más avanzados
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
  const [sobre, setSobre] = useState<Etapa | null>(null);
  const esMovil = useEsMovil();
  const tablero = useRef<HTMLDivElement>(null);
  const [etapaVisible, setEtapaVisible] = useState(0);
  // En el celular las columnas se deslizan; las pestañas saltan a cada etapa.
  function irA(i: number) {
    const t = tablero.current;
    const col = t?.children[i] as HTMLElement | undefined;
    if (t && col) t.scrollTo({ left: col.offsetLeft, behavior: "smooth" }); // .kanban es position: relative
    setEtapaVisible(i);
  }

  const flotas = useMemo(
    () => [...new Set((backlogs ?? []).map((b) => b.flota).filter((f): f is string => !!f))].sort(),
    [backlogs]
  );

  const visibles = useMemo(() => {
    const limiteValidados = Date.now() - DIAS_VALIDADOS * 86400000;
    const t = buscar.trim().toLowerCase();
    return (backlogs ?? [])
      .filter((b) => TODOS.includes(b.estado))
      .filter((b) => b.estado !== "Validado" || new Date(b.actualizado_en).getTime() >= limiteValidados)
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

  // Transición al soltar en una columna: la que lleva a uno de sus estados.
  const transicionHacia = (b: BacklogFila, col: (typeof COLUMNAS)[number]) =>
    col.estados.includes(b.estado) ? undefined : permitidas(b.estado).find((t) => col.estados.includes(t.destino));

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
            <option key={p} value={p}>{nombrePrioridad(p)}</option>
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

      {esMovil && (
        <div className="etapas-movil" role="tablist" aria-label="Etapas">
          {COLUMNAS.map((c, i) => (
            <button
              key={c.etapa}
              role="tab"
              aria-selected={etapaVisible === i}
              className={etapaVisible === i ? "activa" : undefined}
              onClick={() => irA(i)}
            >
              {i + 1}. {c.etapa} ({visibles.filter((b) => c.estados.includes(b.estado)).length})
            </button>
          ))}
        </div>
      )}
      {isLoading ? (
        <p className="nota">Cargando…</p>
      ) : (
        <div
          className="kanban"
          ref={tablero}
          onScroll={(e) => {
            if (!esMovil) return;
            const t = e.currentTarget;
            const ancho = (t.children[0] as HTMLElement | undefined)?.offsetWidth ?? t.clientWidth;
            setEtapaVisible(Math.min(COLUMNAS.length - 1, Math.round(t.scrollLeft / (ancho + 8))));
          }}
        >
          {COLUMNAS.map((col, i) => {
            const tarjetas = visibles.filter((b) => col.estados.includes(b.estado)).sort(ordenTarjetas);
            const hh = tarjetas.reduce((s, b) => s + Number(b.hh_estimadas), 0);
            const admite = arrastrando ? !!transicionHacia(arrastrando, col) : false;
            const propia = arrastrando ? col.estados.includes(arrastrando.estado) : false;
            return (
              <section
                key={col.etapa}
                className={`columna-kanban${arrastrando && admite ? " admite" : ""}${sobre === col.etapa && admite ? " sobre" : ""}${arrastrando && !admite && !propia ? " no-admite" : ""}`}
                aria-label={col.etapa}
                onDragOver={(e) => {
                  if (!admite) return;
                  e.preventDefault();
                  setSobre(col.etapa);
                }}
                onDragLeave={() => setSobre((s) => (s === col.etapa ? null : s))}
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
                <header className={`columna-cabecera est-${col.etapa.toLowerCase()}`}>
                  <span>
                    {i + 1}. {col.etapa}
                    {col.etapa === "Validado" && <span className="columna-nota"> ({DIAS_VALIDADOS} días)</span>}
                  </span>
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
                      eventos={detalle?.eventos.get(b.id) ?? []}
                      especialidades={especialidades ?? []}
                      abierta={abiertas.has(b.id)}
                      onAlternar={() => alternar(b.id)}
                      acciones={permitidas(b.estado)}
                      onAccion={(t) => cambio.abrir(b, t)}
                      arrastrable={!esMovil && permitidas(b.estado).length > 0}
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
