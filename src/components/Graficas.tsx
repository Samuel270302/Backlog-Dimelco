import { useState } from "react";
import { fFecha, fNum } from "../lib/fmt";

// Gráficas de Indicadores. Colores de la paleta validada (posiciones 1 y 2);
// el texto va siempre en tinta de texto, nunca en el color de la serie.
export const SERIE_1 = "#2a78d6";
export const SERIE_2 = "#eb6834";

export interface FilaBarra {
  etiqueta: string;
  valor: number | null;
  texto: string; // valor ya formateado, va al final de la barra
  detalle?: string; // tooltip
}

// Barras horizontales de una sola serie, con línea de referencia opcional.
export function BarrasHorizontales({
  filas,
  maximo,
  referencia,
  etiquetaReferencia,
  nombre,
}: {
  filas: FilaBarra[];
  maximo?: number;
  referencia?: number;
  etiquetaReferencia?: string;
  nombre: string;
}) {
  const tope = Math.max(maximo ?? 0, referencia ?? 0, ...filas.map((f) => f.valor ?? 0)) || 1;
  return (
    <div className="barras-h" role="img" aria-label={nombre}>
      {filas.map((f) => (
        <div key={f.etiqueta} className="bh-fila" title={f.detalle ?? `${f.etiqueta}: ${f.texto}`}>
          <span className="bh-etiqueta">{f.etiqueta}</span>
          <span className="bh-pista">
            {f.valor !== null && f.valor > 0 && (
              <span className="bh-barra" style={{ width: `${(f.valor / tope) * 100}%`, background: SERIE_1 }} />
            )}
            {referencia !== undefined && (
              <span className="bh-referencia" style={{ left: `${(referencia / tope) * 100}%` }} />
            )}
          </span>
          <span className="bh-valor">{f.texto}</span>
        </div>
      ))}
      {referencia !== undefined && etiquetaReferencia && (
        <div className="bh-leyenda-ref">
          <span className="bh-muestra-ref" /> {etiquetaReferencia}
        </div>
      )}
    </div>
  );
}

const ANCHO = 1040;
const ALTO = 190;
const M = { arriba: 12, derecha: 12, abajo: 26, izquierda: 32 };

function escala(max: number) {
  const paso = max <= 5 ? 1 : max <= 10 ? 2 : max <= 25 ? 5 : max <= 50 ? 10 : Math.ceil(max / 50) * 10;
  const tope = Math.max(paso, Math.ceil(max / paso) * paso);
  const marcas = [];
  for (let v = 0; v <= tope; v += paso) marcas.push(v);
  return { tope, marcas };
}

interface PuntoSemana {
  lunes: string;
  a: number;
  b?: number;
}

// Barras agrupadas por semana (dos series) o una línea (una serie), con tooltip al pasar el mouse.
export function GraficaSemanal({
  datos,
  nombreA,
  nombreB,
  forma,
  titulo,
}: {
  datos: PuntoSemana[];
  nombreA: string;
  nombreB?: string;
  forma: "barras" | "linea";
  titulo: string;
}) {
  const [activo, setActivo] = useState<number | null>(null);
  const max = Math.max(1, ...datos.flatMap((d) => [d.a, d.b ?? 0]));
  const { tope, marcas } = escala(max);
  const anchoUtil = ANCHO - M.izquierda - M.derecha;
  const altoUtil = ALTO - M.arriba - M.abajo;
  const banda = anchoUtil / datos.length;
  const y = (v: number) => M.arriba + altoUtil - (v / tope) * altoUtil;
  const xCentro = (i: number) => M.izquierda + banda * i + banda / 2;
  const anchoBarra = Math.min(18, (banda - 12) / (nombreB ? 2 : 1));

  const camino = datos.map((d, i) => `${i ? "L" : "M"}${xCentro(i)},${y(d.a)}`).join(" ");
  const p = activo !== null ? datos[activo] : null;

  return (
    <figure className="grafica-semanal">
      <figcaption>
        <span className="gs-titulo">{titulo}</span>
        {nombreB && (
          <span className="gs-leyenda">
            <span><i style={{ background: SERIE_1 }} /> {nombreA}</span>
            <span><i style={{ background: SERIE_2 }} /> {nombreB}</span>
          </span>
        )}
      </figcaption>
      <div className="gs-lienzo">
        <svg viewBox={`0 0 ${ANCHO} ${ALTO}`} role="img" aria-label={titulo} onMouseLeave={() => setActivo(null)}>
          {marcas.map((v) => (
            <g key={v}>
              <line x1={M.izquierda} x2={ANCHO - M.derecha} y1={y(v)} y2={y(v)} className="gs-grilla" />
              <text x={M.izquierda - 6} y={y(v) + 4} className="gs-eje" textAnchor="end">
                {v}
              </text>
            </g>
          ))}
          {datos.map((d, i) => (
            <text key={d.lunes} x={xCentro(i)} y={ALTO - 8} className="gs-eje" textAnchor="middle">
              {d.lunes.slice(8, 10)}/{d.lunes.slice(5, 7)}
            </text>
          ))}
          {activo !== null && (
            <rect x={M.izquierda + banda * activo} y={M.arriba} width={banda} height={altoUtil} className="gs-foco" />
          )}
          {forma === "barras" &&
            datos.map((d, i) => {
              const series = nombreB ? [{ v: d.a, c: SERIE_1 }, { v: d.b ?? 0, c: SERIE_2 }] : [{ v: d.a, c: SERIE_1 }];
              const inicio = xCentro(i) - (anchoBarra * series.length + 2 * (series.length - 1)) / 2;
              return series.map((s, j) =>
                s.v > 0 ? (
                  <path
                    key={`${i}-${j}`}
                    d={barraRedondeada(inicio + j * (anchoBarra + 2), y(s.v), anchoBarra, y(0) - y(s.v))}
                    fill={s.c}
                  />
                ) : null
              );
            })}
          {forma === "linea" && (
            <>
              <path d={camino} fill="none" stroke={SERIE_1} strokeWidth={2} />
              {datos.map((d, i) => (
                <circle key={d.lunes} cx={xCentro(i)} cy={y(d.a)} r={activo === i ? 5 : 3.5} fill={SERIE_1} stroke="#fff" strokeWidth={2} />
              ))}
            </>
          )}
          {datos.map((d, i) => (
            <rect
              key={`zona-${d.lunes}`}
              x={M.izquierda + banda * i}
              y={M.arriba}
              width={banda}
              height={altoUtil}
              fill="transparent"
              onMouseEnter={() => setActivo(i)}
            />
          ))}
        </svg>
        {p && activo !== null && (
          <div className="gs-tooltip" style={{ left: `${(xCentro(activo) / ANCHO) * 100}%` }}>
            <div className="gs-tt-titulo">Semana del {fFecha(p.lunes)}</div>
            <div><i style={{ background: SERIE_1 }} /> {nombreA}: <b>{fNum(p.a)}</b></div>
            {nombreB && <div><i style={{ background: SERIE_2 }} /> {nombreB}: <b>{fNum(p.b ?? 0)}</b></div>}
          </div>
        )}
      </div>
    </figure>
  );
}

// Barra con la punta redondeada (4 px) y la base recta sobre el eje.
function barraRedondeada(x: number, y: number, w: number, h: number) {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}
