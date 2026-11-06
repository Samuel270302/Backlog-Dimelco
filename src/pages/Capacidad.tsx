import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { useCapacidad, useCapacidadVigente, useEspecialidades } from "../lib/queries";
import { useUnidad, useUnidades } from "../lib/unidad";
import { useAvisos } from "../components/Avisos";
import { fFecha, fNum, hoyISO } from "../lib/fmt";

// HH disponibles por semana por unidad y especialidad. Cada cambio es una fila nueva
// con su fecha de vigencia; así los indicadores de semanas anteriores no cambian.
interface Edicion {
  unidad_id: string;
  especialidad_id: string;
  personas: string;
  horas: string;
  turnos: string;
  hh: string;
  vigente_desde: string;
}

export default function Capacidad() {
  const qc = useQueryClient();
  const { avisar } = useAvisos();
  const { unidadId, permitidas } = useUnidad();
  const { data: unidades } = useUnidades();
  const { data: especialidades } = useEspecialidades();
  const { data: vigente } = useCapacidadVigente();
  const { data: historial } = useCapacidad();
  const [ed, setEd] = useState<Edicion | null>(null);

  const unidadesVisibles = (unidades ?? []).filter((u) => u.activo && (unidadId ? u.id === unidadId : !permitidas || permitidas.includes(u.id)));
  const nombreUnidad = (id: string) => unidades?.find((u) => u.id === id)?.nombre ?? "";
  const nombreEsp = (id: string) => especialidades?.find((e) => e.id === id)?.nombre ?? "";
  const vigenteDe = (u: string, e: string) => vigente?.find((c) => c.unidad_id === u && c.especialidad_id === e);

  const calculada = ed ? Number(ed.personas) * Number(ed.horas) * Number(ed.turnos) : 0;

  const grabar = useMutation({
    mutationFn: async (x: Edicion) => {
      const hh = Number(x.hh);
      const existente = historial?.find(
        (c) => c.unidad_id === x.unidad_id && c.especialidad_id === x.especialidad_id && c.vigente_desde === x.vigente_desde
      );
      const t = supabase().from("capacidad_taller");
      const { error } = existente
        ? await t.update({ hh_semana: hh }).eq("id", existente.id)
        : await t.insert({ unidad_id: x.unidad_id, especialidad_id: x.especialidad_id, hh_semana: hh, vigente_desde: x.vigente_desde });
      if (error) throw error;
    },
    onSuccess: () => {
      setEd(null);
      qc.invalidateQueries();
      avisar("Capacidad grabada");
    },
    onError: (e: Error) => avisar(e.message, "error"),
  });

  const historialOrdenado = useMemo(
    () =>
      [...(historial ?? [])].sort(
        (a, b) =>
          nombreUnidad(a.unidad_id).localeCompare(nombreUnidad(b.unidad_id)) ||
          nombreEsp(a.especialidad_id).localeCompare(nombreEsp(b.especialidad_id)) ||
          b.vigente_desde.localeCompare(a.vigente_desde)
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [historial, unidades, especialidades]
  );

  const valida = ed && Number(ed.hh) >= 0 && ed.hh !== "" && ed.vigente_desde;

  return (
    <div className="pagina-formulario formato">
      <h1>Capacidad del taller</h1>
      <p className="subtitulo">
        HH disponibles por semana para trabajos de backlog. Se comparan con lo programado en el calendario y con el backlog
        pendiente (semanas de backlog).
      </p>

      {unidadesVisibles.map((u) => (
        <section key={u.id} className="bloque-ficha">
          <h2>{u.nombre}</h2>
          <div className="tabla-marco">
            <table className="tabla-edicion">
              <thead>
                <tr>
                  <th>Especialidad</th>
                  <th className="num">HH por semana</th>
                  <th>Vigente desde</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(especialidades ?? [])
                  .filter((e) => e.activo)
                  .map((e) => {
                    const c = vigenteDe(u.id, e.id);
                    const editando = ed?.unidad_id === u.id && ed.especialidad_id === e.id;
                    return (
                      <tr key={e.id} className={editando ? "fila-nueva" : undefined}>
                        <td>{e.nombre}</td>
                        {editando && ed ? (
                          <td colSpan={3}>
                            <div className="calculadora">
                              <label>
                                Personas
                                <input type="number" min={0} step={1} value={ed.personas} aria-label={`Personas ${e.nombre}`}
                                  onChange={(x) => setEd({ ...ed, personas: x.target.value, hh: String(Number(x.target.value) * Number(ed.horas) * Number(ed.turnos) || "") })} />
                              </label>
                              <span>×</span>
                              <label>
                                Horas efectivas por turno
                                <input type="number" min={0} step={0.5} value={ed.horas} aria-label={`Horas por turno ${e.nombre}`}
                                  onChange={(x) => setEd({ ...ed, horas: x.target.value, hh: String(Number(ed.personas) * Number(x.target.value) * Number(ed.turnos) || "") })} />
                              </label>
                              <span>×</span>
                              <label>
                                Turnos por semana
                                <input type="number" min={0} step={1} value={ed.turnos} aria-label={`Turnos ${e.nombre}`}
                                  onChange={(x) => setEd({ ...ed, turnos: x.target.value, hh: String(Number(ed.personas) * Number(ed.horas) * Number(x.target.value) || "") })} />
                              </label>
                              <span>=</span>
                              <label>
                                HH por semana
                                <input type="number" min={0} step="any" value={ed.hh} aria-label={`HH por semana ${e.nombre}`}
                                  onChange={(x) => setEd({ ...ed, hh: x.target.value })} />
                              </label>
                              <label>
                                Vigente desde
                                <input type="date" value={ed.vigente_desde} aria-label={`Vigente desde ${e.nombre}`}
                                  onChange={(x) => setEd({ ...ed, vigente_desde: x.target.value })} />
                              </label>
                              <button className="boton-plano" onClick={() => setEd(null)}>Cancelar</button>
                              <button disabled={!valida || grabar.isPending} onClick={() => ed && grabar.mutate(ed)}>Grabar</button>
                            </div>
                            {calculada > 0 && Number(ed.hh) !== calculada && (
                              <p className="nota">La calculadora da {fNum(calculada)} HH; se grabará el valor escrito.</p>
                            )}
                          </td>
                        ) : (
                          <>
                            <td className="num">{c ? fNum(c.hh_semana) : <span className="nota">sin cargar</span>}</td>
                            <td>{c ? fFecha(c.vigente_desde) : ""}</td>
                            <td>
                              <button
                                className="boton-plano"
                                aria-label={`Cambiar ${e.nombre} ${u.nombre}`}
                                onClick={() =>
                                  setEd({
                                    unidad_id: u.id,
                                    especialidad_id: e.id,
                                    personas: "",
                                    horas: "",
                                    turnos: "",
                                    hh: c ? String(c.hh_semana) : "",
                                    vigente_desde: hoyISO(),
                                  })
                                }
                              >
                                Cambiar
                              </button>
                            </td>
                          </>
                        )}
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <section className="bloque-ficha">
        <h2>Historial</h2>
        {historialOrdenado.length === 0 ? (
          <p className="nota">Todavía no se cargó capacidad.</p>
        ) : (
          <div className="tabla-marco">
            <table>
              <thead>
                <tr>
                  <th>Unidad</th>
                  <th>Especialidad</th>
                  <th className="num">HH por semana</th>
                  <th>Vigente desde</th>
                </tr>
              </thead>
              <tbody>
                {historialOrdenado.map((c) => (
                  <tr key={c.id}>
                    <td>{nombreUnidad(c.unidad_id)}</td>
                    <td>{nombreEsp(c.especialidad_id)}</td>
                    <td className="num">{fNum(c.hh_semana)}</td>
                    <td>{fFecha(c.vigente_desde)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
