import { useMemo } from "react";
import { EN_PAQUETE } from "../lib/paquete";
import { fFecha, hoyISO, lunesDe, sumarDiasISO } from "../lib/fmt";
import type { BacklogFila, Paquete, Preventivo } from "../lib/types";
import type { ClavePaquete } from "./paquetes/Paquetes";

const DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

interface Grupo {
  equipo_id: string;
  cod: string;
  pms: number;
  correctivos: number;
  hechas: number;
}

// Vista mensual: en cada día, un botón por equipo con órdenes programadas. El botón abre
// el paquete de ese equipo y día para verlo e imprimirlo.
export default function CalendarioMes({
  mes,
  backlogs,
  preventivos,
  paquetes,
  puedeCapturar,
  ocupado,
  onPaquete,
  onPaquetesDia,
  onProgramarPm,
  onVerSemana,
}: {
  mes: string; // primer día del mes (AAAA-MM-01)
  backlogs: BacklogFila[];
  preventivos: Preventivo[];
  paquetes: Paquete[];
  puedeCapturar: boolean;
  ocupado: boolean;
  onPaquete: (c: ClavePaquete) => void;
  onPaquetesDia: (claves: ClavePaquete[]) => void;
  onProgramarPm: (fecha: string) => void;
  onVerSemana: (lunes: string) => void;
}) {
  const hoy = hoyISO();
  // Semanas completas (lunes a domingo) que tocan el mes.
  const semanas = useMemo(() => {
    const filas: string[][] = [];
    for (let l = lunesDe(mes); l.slice(0, 7) <= mes.slice(0, 7); l = sumarDiasISO(l, 7)) {
      filas.push(Array.from({ length: 7 }, (_, i) => sumarDiasISO(l, i)));
    }
    return filas;
  }, [mes]);

  const porDia = useMemo(() => {
    const m = new Map<string, Map<string, Grupo>>();
    const grupo = (fecha: string, equipo_id: string, cod: string) => {
      const dia = m.get(fecha) ?? new Map<string, Grupo>();
      m.set(fecha, dia);
      const g = dia.get(equipo_id) ?? { equipo_id, cod, pms: 0, correctivos: 0, hechas: 0 };
      dia.set(equipo_id, g);
      return g;
    };
    for (const p of preventivos) {
      if (p.estado === "Anulado") continue;
      const g = grupo(p.fecha_programada, p.equipo_id, p.cod_interno);
      g.pms++;
      if (p.estado === "Ejecutado") g.hechas++;
    }
    for (const b of backlogs) {
      if (!b.fecha_programada || !EN_PAQUETE.includes(b.estado)) continue;
      const g = grupo(b.fecha_programada, b.equipo_id, b.cod_interno);
      g.correctivos++;
      if (b.estado !== "Programado") g.hechas++;
    }
    return m;
  }, [backlogs, preventivos]);
  const folio = (equipo_id: string, fecha: string) => paquetes.find((q) => q.equipo_id === equipo_id && q.fecha === fecha)?.folio;

  return (
    <div className="mes" aria-label="Calendario mensual">
      <div className="mes-cabecera">
        <span className="mes-semana" />
        {DIAS.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      {semanas.map((dias) => (
        <div key={dias[0]} className="mes-fila">
          <button className="boton-plano mes-semana" title="Ver esta semana en detalle" aria-label={`Ver semana del ${fFecha(dias[0])}`} onClick={() => onVerSemana(dias[0])}>
            ›
          </button>
          {dias.map((d) => {
            const grupos = [...(porDia.get(d)?.values() ?? [])].sort((a, b) => a.cod.localeCompare(b.cod));
            const clases = ["mes-dia", d.slice(0, 7) !== mes.slice(0, 7) ? "otro-mes" : "", d === hoy ? "hoy" : "", d < hoy ? "pasado" : "", grupos.length ? "con-ordenes" : ""];
            return (
              <div key={d} className={clases.filter(Boolean).join(" ")} aria-label={`Día ${fFecha(d)}`}>
                <div className="mes-dia-cabecera">
                  <span className="mes-numero">
                    <span className="mes-dia-nombre">{DIAS[(new Date(d + "T00:00:00").getDay() + 6) % 7]} </span>
                    {d.slice(8, 10)}
                    {d.slice(8, 10) === "01" || d === dias[0] ? `/${d.slice(5, 7)}` : ""}
                  </span>
                  {puedeCapturar && grupos.length > 1 && (
                    <button
                      className="boton-plano mes-todos"
                      disabled={ocupado}
                      aria-label={`Imprimir paquetes del ${fFecha(d)}`}
                      title="Imprimir en un solo PDF los paquetes de todos los equipos de este día"
                      onClick={() => onPaquetesDia(grupos.map((g) => ({ equipo_id: g.equipo_id, fecha: d })))}
                    >
                      Todos ({grupos.length})
                    </button>
                  )}
                  {puedeCapturar && (
                    <button className="boton-plano mes-pm" aria-label={`Programar preventivo el ${fFecha(d)}`} title="Programar un preventivo este día" onClick={() => onProgramarPm(d)}>
                      + PM
                    </button>
                  )}
                </div>
                {grupos.map((g) => {
                  const f = folio(g.equipo_id, d);
                  const total = g.pms + g.correctivos;
                  return (
                    <button
                      key={g.equipo_id}
                      className={`paquete-mes${g.pms ? " con-pm" : ""}${g.hechas === total ? " hecho" : ""}`}
                      aria-label={`Paquete ${g.cod} ${fFecha(d)}`}
                      title="Ver e imprimir el paquete de órdenes de este equipo y día"
                      onClick={() => onPaquete({ equipo_id: g.equipo_id, fecha: d })}
                    >
                      <b>{g.cod}</b>
                      <span>
                        {[g.pms ? `${g.pms} PM` : "", g.correctivos ? `${g.correctivos} correctivo${g.correctivos > 1 ? "s" : ""}` : ""].filter(Boolean).join(" + ")}
                      </span>
                      <span className="paquete-mes-folio">{f ?? "Sin imprimir"}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
