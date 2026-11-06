import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { todo } from "../lib/queries";
import { useAvisos } from "../components/Avisos";
import DialogoConfirmar from "../components/DialogoConfirmar";
import { PRIORIDADES, nombrePrioridad } from "../lib/types";

// Plazos de atención por prioridad (admin). La fecha límite de un backlog es la
// fecha de detección más el plazo de su prioridad.
interface Parametro {
  clave: string;
  valor: number | null;
  descripcion: string | null;
}

export default function Parametros() {
  const qc = useQueryClient();
  const { avisar } = useAvisos();
  const { data: parametros } = useQuery({ queryKey: ["parametros"], queryFn: () => todo<Parametro>("parametros", "clave") });
  const [confirmar, setConfirmar] = useState(false);
  const plazo = (p: string) => parametros?.find((x) => x.clave === `plazo_${p.toLowerCase()}_dias`)?.valor ?? null;

  const grabar = useMutation({
    mutationFn: async ({ clave, valor }: { clave: string; valor: number }) => {
      const { error } = await supabase().from("parametros").update({ valor }).eq("clave", clave);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries();
      avisar("Plazo grabado. Rige para backlogs nuevos; para los abiertos use «Recalcular».");
    },
    onError: (e: Error) => avisar(e.message, "error"),
  });

  const recalcular = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase().rpc("recalcular_fechas_limite");
      if (error) throw error;
      return data as number;
    },
    onSuccess: (n) => {
      qc.invalidateQueries();
      avisar(`${n} backlog(s) abiertos con fecha límite nueva`);
    },
    onError: (e: Error) => avisar(e.message, "error"),
  });

  return (
    <div className="pagina-formulario">
      <h1>Plazos por prioridad</h1>
      <p className="subtitulo">
        Días para atender un backlog desde su detección. La fecha límite define qué está vencido en el Kanban, la vista por
        equipo, los indicadores y el reporte semanal.
      </p>
      <section className="bloque-ficha" style={{ maxWidth: 560 }}>
        <table className="tabla-edicion">
          <thead>
            <tr>
              <th>Prioridad</th>
              <th className="num">Plazo (días)</th>
            </tr>
          </thead>
          <tbody>
            {PRIORIDADES.map((p) => (
              <tr key={p}>
                <td>{nombrePrioridad(p)}</td>
                <td className="num">
                  <input
                    key={`${p}-${plazo(p)}`}
                    type="number"
                    min={0}
                    step={1}
                    defaultValue={plazo(p) ?? ""}
                    aria-label={`Plazo ${p}`}
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (e.target.value === "" || !Number.isInteger(v) || v < 0) {
                        avisar("El plazo es un número entero de días", "error");
                        e.target.value = String(plazo(p) ?? "");
                        return;
                      }
                      if (v !== plazo(p)) grabar.mutate({ clave: `plazo_${p.toLowerCase()}_dias`, valor: v });
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="barra-acciones" style={{ marginTop: 12, marginBottom: 0 }}>
          <span className="nota">Un plazo nuevo no cambia solo las fechas límite de los backlogs abiertos.</span>
          <div className="espacio" />
          <button className="boton-secundario" disabled={recalcular.isPending} onClick={() => setConfirmar(true)}>
            Recalcular abiertos
          </button>
        </div>
      </section>
      {confirmar && (
        <DialogoConfirmar
          titulo="Recalcular fechas límite"
          texto="Todos los backlogs abiertos toman la fecha límite de los plazos actuales. Algunos pueden pasar a vencidos o dejar de estarlo."
          confirmar="Recalcular"
          onRespuesta={(si) => {
            setConfirmar(false);
            if (si) recalcular.mutate();
          }}
        />
      )}
    </div>
  );
}
