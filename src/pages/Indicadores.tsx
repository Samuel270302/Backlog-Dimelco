import { useMemo, useState } from "react";
import { useBacklogs, useSemanasBacklog } from "../lib/queries";
import { useNombreUnidad, useUnidades } from "../lib/unidad";
import { antiguedad, resumen, semanal, semanasPorEspecialidad, vencidosPorPrioridad } from "../lib/indicadores";
import { reporteSemanal } from "../lib/reporte";
import { exportarAbiertos } from "../lib/exportar";
import { BarrasHorizontales, GraficaSemanal } from "../components/Graficas";
import { useAvisos } from "../components/Avisos";
import { fNum, hoyISO, fFecha } from "../lib/fmt";
import { nombrePrioridad } from "../lib/types";

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)} %`);

function Tile({ valor, etiqueta, nota, alerta }: { valor: string; etiqueta: string; nota?: string; alerta?: boolean }) {
  return (
    <div className={`tile${alerta ? " alerta" : ""}`}>
      <div className="tile-valor">{valor}</div>
      <div className="tile-etiqueta">{etiqueta}</div>
      {nota && <div className="tile-nota">{nota}</div>}
    </div>
  );
}

export default function Indicadores() {
  const { data: filas, isLoading } = useBacklogs();
  const { data: semanasBd } = useSemanasBacklog();
  const { data: unidades } = useUnidades();
  const nombreUnidad = useNombreUnidad();
  const { avisar } = useAvisos();
  const [ocupado, setOcupado] = useState<"" | "pdf" | "excel">("");
  const hoy = hoyISO();
  const unidad = nombreUnidad ?? "Todas las unidades";

  const datos = useMemo(() => {
    const f = filas ?? [];
    return {
      r: resumen(f, hoy),
      sem: semanasPorEspecialidad(semanasBd ?? []),
      ant: antiguedad(f),
      venc: vencidosPorPrioridad(f),
      semanas: semanal(f, hoy, 12),
    };
  }, [filas, semanasBd, hoy]);
  const { r, sem, ant, venc, semanas } = datos;
  const porHh = sem.lista.filter((s) => s.hhPendientes > 0).sort((a, b) => b.hhPendientes - a.hhPendientes);

  async function pdf() {
    setOcupado("pdf");
    try {
      const ruta = await reporteSemanal({ filas: filas ?? [], semanas: sem, unidad, hoy });
      if (ruta) avisar(`Reporte guardado en ${ruta}`);
    } catch (e) {
      avisar(`No se pudo generar el reporte: ${(e as Error).message}`, "error");
    } finally {
      setOcupado("");
    }
  }

  async function excel() {
    setOcupado("excel");
    try {
      const ruta = await exportarAbiertos(
        filas ?? [],
        sem.lista,
        new Map((unidades ?? []).map((u) => [u.id, u.nombre])),
        `Backlog abierto ${unidad} ${hoy}`
      );
      if (ruta) avisar(`Excel guardado en ${ruta}`);
    } catch (e) {
      avisar(`No se pudo exportar: ${(e as Error).message}`, "error");
    } finally {
      setOcupado("");
    }
  }

  if (isLoading) return <p className="nota">Cargando…</p>;

  return (
    <div className="pagina-indicadores">
      <div className="barra-acciones">
        <div>
          <h1 style={{ margin: 0 }}>Indicadores</h1>
          <p className="subtitulo" style={{ margin: 0 }}>
            {unidad} · al {fFecha(hoy)}
          </p>
        </div>
        <div className="espacio" />
        <button className="boton-plano" disabled={!!ocupado} onClick={excel}>
          {ocupado === "excel" ? "Exportando…" : "Exportar abiertos a Excel"}
        </button>
        <button disabled={!!ocupado} onClick={pdf}>
          {ocupado === "pdf" ? "Generando…" : "Reporte semanal PDF"}
        </button>
      </div>

      <div className="tiles">
        <Tile valor={String(r.abiertos)} etiqueta="Backlogs abiertos" />
        <Tile valor={fNum(r.hhPendientes)} etiqueta="HH acumuladas pendientes" nota="HH estimadas de los abiertos" />
        <Tile
          valor={sem.total.semanas === null ? "—" : fNum(sem.total.semanas, 2)}
          etiqueta="Semanas de backlog"
          nota={sem.total.semanas === null ? "Sin capacidad del taller cargada" : `${fNum(sem.total.hhSemana)} HH por semana`}
        />
        <Tile valor={String(r.vencidos)} etiqueta="Vencidos" nota={r.abiertos ? `${pct(r.vencidos / r.abiertos)} de los abiertos` : undefined} alerta={r.vencidos > 0} />
        <Tile valor={pct(r.pctProgramado)} etiqueta="HH pendientes ya programadas" nota={`${fNum(r.hhProgramadas)} HH`} />
        <Tile valor={pct(r.pctEnPlazo)} etiqueta="Cerrados dentro del plazo" nota={`${r.cierresEnPlazo4} de ${r.cierres4} en 4 semanas`} />
      </div>

      <div className="rejilla-indicadores">
        <section className="bloque-ficha">
          <h2>HH acumuladas por especialidad</h2>
          <p className="nota">HH estimadas de los backlogs abiertos. Con capacidad cargada, la tabla muestra también las semanas de backlog.</p>
          {porHh.length === 0 ? (
            <p className="nota">Sin HH pendientes.</p>
          ) : (
            <BarrasHorizontales
              nombre="HH acumuladas por especialidad"
              filas={porHh.map((s) => ({
                etiqueta: s.especialidad,
                valor: s.hhPendientes,
                texto: `${fNum(s.hhPendientes)} HH`,
                detalle: `${s.especialidad}: ${fNum(s.hhPendientes)} HH pendientes${s.semanas === null ? "" : ` · ${fNum(s.semanas, 2)} semanas`}`,
              }))}
            />
          )}
          {r.sinHh > 0 && <p className="nota">{r.sinHh} backlog(s) abiertos sin HH estimadas no entran en el cálculo.</p>}
          <details className="ver-tabla">
            <summary>Ver tabla</summary>
            <table>
              <thead>
                <tr><th>Especialidad</th><th className="num">HH pendientes</th><th className="num">HH por semana</th><th className="num">Semanas</th></tr>
              </thead>
              <tbody>
                {[...porHh, { ...sem.total, hhPendientes: porHh.reduce((t, s) => t + s.hhPendientes, 0) }].map((s) => (
                  <tr key={s.especialidad}>
                    <td>{s.especialidad}</td>
                    <td className="num">{fNum(s.hhPendientes)}</td>
                    <td className="num">{s.hhSemana ? fNum(s.hhSemana) : "—"}</td>
                    <td className="num">{s.semanas === null ? "—" : fNum(s.semanas, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </section>

        <section className="bloque-ficha">
          <h2>Antigüedad de los abiertos</h2>
          <p className="nota">Días desde la detección.</p>
          <BarrasHorizontales
            nombre="Antigüedad de los backlogs abiertos"
            filas={ant.map((a) => ({
              etiqueta: a.etiqueta,
              valor: a.cantidad,
              texto: `${a.cantidad} · ${fNum(a.hh)} HH`,
            }))}
          />
          <h2 style={{ marginTop: 14 }}>Vencidos por prioridad</h2>
          <table className="tabla-chica">
            <thead>
              <tr><th>Prioridad</th><th className="num">Abiertos</th><th className="num">Vencidos</th></tr>
            </thead>
            <tbody>
              {venc.map((v) => (
                <tr key={v.prioridad}>
                  <td>{nombrePrioridad(v.prioridad)}</td>
                  <td className="num">{v.abiertos}</td>
                  <td className={`num${v.vencidos ? " texto-vencido" : ""}`}>{v.vencidos}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <section className="bloque-ficha">
        <h2>Ingresos y cierres por semana</h2>
        <p className="nota">Ingresos: backlogs detectados. Cierres: ejecutados. Últimas 12 semanas; no cuentan rechazados ni anulados.</p>
        <GraficaSemanal
          titulo="Backlogs por semana"
          forma="barras"
          nombreA="Ingresos"
          nombreB="Cierres"
          datos={semanas.map((s) => ({ lunes: s.lunes, a: s.ingresos, b: s.cierres }))}
        />
        <GraficaSemanal
          titulo="Backlog abierto al cierre de cada semana"
          forma="linea"
          nombreA="Abiertos"
          datos={semanas.map((s) => ({ lunes: s.lunes, a: s.abiertosAlCierre }))}
        />
        <details className="ver-tabla">
          <summary>Ver tabla</summary>
          <table>
            <thead>
              <tr><th>Semana del</th><th className="num">Ingresos</th><th className="num">Cierres</th><th className="num">Abiertos al cierre</th></tr>
            </thead>
            <tbody>
              {semanas.map((s) => (
                <tr key={s.lunes}>
                  <td>{fFecha(s.lunes)}</td>
                  <td className="num">{s.ingresos}</td>
                  <td className="num">{s.cierres}</td>
                  <td className="num">{s.abiertosAlCierre}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </section>
    </div>
  );
}
