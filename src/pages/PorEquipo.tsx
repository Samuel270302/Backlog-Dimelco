import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useBacklogs, useEquipos } from "../lib/queries";
import { EtiquetaEstado, EtiquetaPrioridad } from "../components/Etiquetas";
import { ESTADOS_ABIERTOS, type BacklogFila, type Equipo } from "../lib/types";
import { fNum } from "../lib/fmt";

// Pantalla principal: equipos agrupados por flota con sus backlogs abiertos,
// para revisar un equipo antes de una parada o un PM.
const abierto = (b: BacklogFila) => ESTADOS_ABIERTOS.includes(b.estado);

interface ResumenEquipo {
  equipo: Equipo;
  abiertos: BacklogFila[];
  hh: number;
  vencidos: number;
  masAntiguo: number;
  urgentes: number;
}

export default function PorEquipo() {
  const { data: equipos, isLoading } = useEquipos();
  const { data: backlogs } = useBacklogs();
  const [buscar, setBuscar] = useState("");
  const [flota, setFlota] = useState("");
  const [soloConBacklog, setSoloConBacklog] = useState(true);
  const [soloVencidos, setSoloVencidos] = useState(false);
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());

  const resumenes = useMemo(() => {
    const porEquipo = new Map<string, BacklogFila[]>();
    for (const b of backlogs ?? []) {
      if (!abierto(b)) continue;
      const l = porEquipo.get(b.equipo_id);
      if (l) l.push(b);
      else porEquipo.set(b.equipo_id, [b]);
    }
    return (equipos ?? [])
      .filter((e) => e.activo)
      .map<ResumenEquipo>((e) => {
        const lista = (porEquipo.get(e.id) ?? []).sort(
          (a, b) => a.prioridad.localeCompare(b.prioridad) || b.antiguedad_dias - a.antiguedad_dias
        );
        return {
          equipo: e,
          abiertos: lista,
          hh: lista.reduce((s, b) => s + Number(b.hh_estimadas), 0),
          vencidos: lista.filter((b) => b.vencido).length,
          masAntiguo: Math.max(0, ...lista.map((b) => b.antiguedad_dias)),
          urgentes: lista.filter((b) => b.tipo_pedido === "Urgente").length,
        };
      });
  }, [equipos, backlogs]);

  const flotas = useMemo(() => [...new Set(resumenes.map((r) => r.equipo.flota ?? "Sin flota"))].sort(), [resumenes]);

  const t = buscar.trim().toLowerCase();
  const filtrados = resumenes
    .filter((r) => !flota || (r.equipo.flota ?? "Sin flota") === flota)
    .filter((r) => !soloConBacklog || r.abiertos.length > 0)
    .filter((r) => !soloVencidos || r.vencidos > 0)
    .filter(
      (r) =>
        !t ||
        `${r.equipo.cod_interno} ${r.equipo.modelo} ${r.equipo.marca ?? ""}`.toLowerCase().includes(t) ||
        r.abiertos.some((b) => `${b.folio} ${b.descripcion}`.toLowerCase().includes(t))
    );
  const grupos = flotas
    .map((f) => ({
      flota: f,
      equipos: filtrados
        .filter((r) => (r.equipo.flota ?? "Sin flota") === f)
        .sort((a, b) => b.vencidos - a.vencidos || b.hh - a.hh || a.equipo.cod_interno.localeCompare(b.equipo.cod_interno)),
    }))
    .filter((g) => g.equipos.length > 0);

  const totalAbiertos = filtrados.reduce((s, r) => s + r.abiertos.length, 0);
  const totalHh = filtrados.reduce((s, r) => s + r.hh, 0);
  const totalVencidos = filtrados.reduce((s, r) => s + r.vencidos, 0);

  function alternar(id: string) {
    setAbiertos((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  return (
    <div>
      <div className="barra-acciones">
        <div>
          <h1 style={{ margin: 0 }}>Backlog por equipo</h1>
          <p className="subtitulo" style={{ margin: 0 }}>
            {totalAbiertos} backlogs abiertos · {fNum(totalHh)} HH estimadas · {totalVencidos} vencidos
          </p>
        </div>
        <div className="espacio" />
        <input
          className="filtro-buscar"
          placeholder="Buscar equipo, folio o trabajo"
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
        <label className="campo-check" style={{ margin: 0 }}>
          <input type="checkbox" checked={soloConBacklog} onChange={(e) => setSoloConBacklog(e.target.checked)} />
          Solo con backlog
        </label>
        <label className="campo-check" style={{ margin: 0 }}>
          <input type="checkbox" checked={soloVencidos} onChange={(e) => setSoloVencidos(e.target.checked)} />
          Solo con vencidos
        </label>
      </div>

      {isLoading && <p className="nota">Cargando…</p>}
      {!isLoading && grupos.length === 0 && <p className="nota">Ningún equipo cumple los filtros.</p>}

      {grupos.map((g) => (
        <section key={g.flota} className="grupo-flota">
          <h2 className="titulo-flota">
            {g.flota} <span className="nota">{g.equipos.length} equipo(s)</span>
          </h2>
          <div className="rejilla-equipos">
            {g.equipos.map((r) => {
              const desplegado = abiertos.has(r.equipo.id);
              const porEstado = ESTADOS_ABIERTOS.map((e) => [e, r.abiertos.filter((b) => b.estado === e).length] as const).filter(
                ([, n]) => n > 0
              );
              return (
                <article
                  key={r.equipo.id}
                  className={`tarjeta-equipo${r.vencidos ? " con-vencidos" : ""}${desplegado ? " desplegada" : ""}`}
                  aria-label={r.equipo.cod_interno}
                >
                  <button className="te-cabecera" onClick={() => alternar(r.equipo.id)} aria-expanded={desplegado}>
                    <span className="te-codigo">{r.equipo.cod_interno}</span>
                    <span className="te-modelo">{[r.equipo.marca, r.equipo.modelo].filter(Boolean).join(" · ")}</span>
                    <span className="te-cifras">
                      <span><b>{r.abiertos.length}</b> abiertos</span>
                      <span><b>{fNum(r.hh)}</b> HH</span>
                      {r.abiertos.length > 0 && <span><b>{r.masAntiguo}</b> d el más antiguo</span>}
                      {r.vencidos > 0 && <span className="texto-vencido"><b>{r.vencidos}</b> vencidos</span>}
                      {r.urgentes > 0 && <span className="etiqueta-urgente">{r.urgentes} urgente(s)</span>}
                    </span>
                    {porEstado.length > 0 && (
                      <span className="te-estados">
                        {porEstado.map(([e, n]) => (
                          <span key={e} className="te-estado">
                            <EtiquetaEstado estado={e} /> {n}
                          </span>
                        ))}
                      </span>
                    )}
                  </button>
                  {desplegado && (
                    <div className="te-detalle">
                      {r.abiertos.length === 0 ? (
                        <p className="nota">Sin backlogs abiertos.</p>
                      ) : (
                        <ul className="te-lista">
                          {r.abiertos.map((b) => (
                            <li key={b.id}>
                              <Link to={`/backlog/${b.id}`} className="te-folio">{b.folio}</Link>
                              <EtiquetaPrioridad prioridad={b.prioridad} />
                              {b.tipo_pedido === "Urgente" && <span className="etiqueta-urgente">Urgente</span>}
                              <span className="te-trabajo">
                                {b.descripcion}
                                {b.componente && <span className="nota"> · {b.componente}</span>}
                              </span>
                              <EtiquetaEstado estado={b.estado} />
                              <span className={b.vencido ? "texto-vencido" : "nota"}>{b.antiguedad_dias} d</span>
                              <span className="nota">{fNum(b.hh_estimadas)} HH</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      <Link to={`/equipo/${r.equipo.id}`} className="enlace-ficha">
                        Historial del equipo
                      </Link>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
