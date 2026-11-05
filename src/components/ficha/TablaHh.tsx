import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAvisos } from "../Avisos";
import { fNum } from "../../lib/fmt";
import type { BacklogHh, Catalogo } from "../../lib/types";

// HH de un tipo (estimadas o reales) por especialidad: una fila por especialidad.
export default function TablaHh({
  backlogId,
  tipo,
  filas,
  especialidades,
  editable,
  motivoBloqueo,
}: {
  backlogId: string;
  tipo: "estimada" | "real";
  filas: BacklogHh[];
  especialidades: Catalogo[];
  editable: boolean;
  motivoBloqueo?: string;
}) {
  const qc = useQueryClient();
  const { avisar } = useAvisos();
  const [nueva, setNueva] = useState({ especialidad_id: "", personas: "1", horas: "" });
  const nombre = (id: string) => especialidades.find((e) => e.id === id)?.nombre ?? "";
  const usadas = new Set(filas.map((f) => f.especialidad_id));
  const libres = especialidades.filter((e) => e.activo && !usadas.has(e.id));
  const total = filas.reduce((s, f) => s + Number(f.hh), 0);

  const accion = useMutation({
    mutationFn: async (op: { tipo: "agregar" } | { tipo: "cambiar"; id: string; campo: "personas" | "horas"; valor: number } | { tipo: "quitar"; id: string }) => {
      const t = supabase().from("backlog_hh");
      const { error } =
        op.tipo === "agregar"
          ? await t.insert({
              backlog_id: backlogId,
              tipo,
              especialidad_id: nueva.especialidad_id,
              personas: Number(nueva.personas),
              horas: Number(nueva.horas),
            })
          : op.tipo === "cambiar"
            ? await t.update({ [op.campo]: op.valor }).eq("id", op.id)
            : await t.delete().eq("id", op.id);
      if (error) throw error;
      return op.tipo;
    },
    onSuccess: (op) => {
      if (op === "agregar") setNueva({ especialidad_id: "", personas: "1", horas: "" });
      qc.invalidateQueries();
    },
    onError: (e: Error) => {
      avisar(e.message, "error");
      qc.invalidateQueries();
    },
  });

  const valida = nueva.especialidad_id && Number(nueva.personas) > 0 && Number(nueva.horas) > 0;

  return (
    <div className="bloque-ficha">
      <h2>{tipo === "estimada" ? "HH estimadas" : "HH reales"}</h2>
      {!editable && motivoBloqueo && <p className="nota">{motivoBloqueo}</p>}
      <div className="tabla-marco">
        <table className="tabla-edicion">
          <thead>
            <tr>
              <th>Especialidad</th>
              <th className="num">Personas</th>
              <th className="num">Horas</th>
              <th className="num">HH</th>
              {editable && <th />}
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.id}>
                <td>{nombre(f.especialidad_id)}</td>
                {(["personas", "horas"] as const).map((campo) => (
                  <td className="num" key={campo}>
                    {editable ? (
                      <input
                        key={`${f.id}-${f[campo]}`}
                        type="number"
                        min={campo === "personas" ? 1 : 0.5}
                        step={campo === "personas" ? 1 : 0.5}
                        defaultValue={f[campo]}
                        aria-label={`${campo} ${nombre(f.especialidad_id)}`}
                        onBlur={(e) => {
                          const v = Number(e.target.value);
                          if (v > 0 && v !== Number(f[campo])) accion.mutate({ tipo: "cambiar", id: f.id, campo, valor: v });
                        }}
                      />
                    ) : (
                      fNum(f[campo])
                    )}
                  </td>
                ))}
                <td className="num">{fNum(f.hh)}</td>
                {editable && (
                  <td>
                    <button className="boton-plano" onClick={() => accion.mutate({ tipo: "quitar", id: f.id })}>
                      Quitar
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {filas.length === 0 && (
              <tr>
                <td colSpan={editable ? 5 : 4} className="nota">
                  Sin HH cargadas.
                </td>
              </tr>
            )}
            {editable && libres.length > 0 && (
              <tr className="fila-nueva">
                <td>
                  <select
                    value={nueva.especialidad_id}
                    onChange={(e) => setNueva((n) => ({ ...n, especialidad_id: e.target.value }))}
                    aria-label="Especialidad nueva"
                  >
                    <option value="">Agregar especialidad…</option>
                    {libres.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.nombre}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="num">
                  <input type="number" min={1} step={1} value={nueva.personas} aria-label="Personas nuevas"
                    onChange={(e) => setNueva((n) => ({ ...n, personas: e.target.value }))} />
                </td>
                <td className="num">
                  <input type="number" min={0.5} step={0.5} value={nueva.horas} aria-label="Horas nuevas"
                    onChange={(e) => setNueva((n) => ({ ...n, horas: e.target.value }))} />
                </td>
                <td className="num">{fNum(Number(nueva.personas) * Number(nueva.horas) || 0)}</td>
                <td>
                  <button disabled={!valida || accion.isPending} onClick={() => accion.mutate({ tipo: "agregar" })}>
                    Agregar
                  </button>
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3}>Total</td>
              <td className="num">{fNum(total)}</td>
              {editable && <td />}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
