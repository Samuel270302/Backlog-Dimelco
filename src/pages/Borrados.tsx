import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { todo, usePorUnidad } from "../lib/queries";
import { useAvisos } from "../components/Avisos";
import DialogoConfirmar from "../components/DialogoConfirmar";
import { EtiquetaEstado } from "../components/Etiquetas";
import { fFecha, fFechaHora } from "../lib/fmt";
import type { Estado } from "../lib/types";

// Backlogs borrados (admin): quién, cuándo y por qué; se pueden restaurar.
interface Borrado {
  id: string;
  folio: string;
  unidad_id: string;
  unidad: string;
  cod_interno: string;
  modelo: string;
  descripcion: string;
  estado: Estado;
  fecha_deteccion: string;
  borrado_en: string;
  borrado_por_nombre: string | null;
  motivo_borrado: string;
}

export default function Borrados() {
  const qc = useQueryClient();
  const { avisar } = useAvisos();
  const { data: filas, isLoading } = useQuery({
    queryKey: ["v_backlog_borrados"],
    queryFn: () => todo<Borrado>("v_backlog_borrados", "borrado_en"),
    select: usePorUnidad<Borrado>(),
  });
  const [aRestaurar, setARestaurar] = useState<Borrado | null>(null);

  const restaurar = useMutation({
    mutationFn: async (b: Borrado) => {
      const { error } = await supabase().rpc("restaurar_backlog", { p_id: b.id });
      if (error) throw error;
      return b;
    },
    onSuccess: (b) => {
      qc.invalidateQueries();
      avisar(`${b.folio} restaurado`);
    },
    onError: (e: Error) => avisar(e.message, "error"),
  });

  const lista = [...(filas ?? [])].sort((a, b) => b.borrado_en.localeCompare(a.borrado_en));

  return (
    <div className="pagina-formulario formato">
      <h1>Backlogs borrados</h1>
      <p className="subtitulo">
        No aparecen en ninguna pantalla, indicador ni reporte. Al restaurar, el backlog vuelve con el estado que tenía. El folio
        no se reutiliza.
      </p>
      {isLoading ? (
        <p className="nota">Cargando…</p>
      ) : lista.length === 0 ? (
        <p className="nota">No hay backlogs borrados.</p>
      ) : (
        <div className="tabla-marco">
          <table className="tabla-edicion">
            <thead>
              <tr>
                <th>Folio</th>
                <th>Unidad</th>
                <th>Equipo</th>
                <th>Trabajo</th>
                <th>Estado que tenía</th>
                <th>Detección</th>
                <th>Borrado</th>
                <th>Por</th>
                <th>Motivo</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lista.map((b) => (
                <tr key={b.id}>
                  <td>{b.folio}</td>
                  <td>{b.unidad}</td>
                  <td>{b.cod_interno} · {b.modelo}</td>
                  <td>{b.descripcion}</td>
                  <td><EtiquetaEstado estado={b.estado} /></td>
                  <td>{fFecha(b.fecha_deteccion)}</td>
                  <td>{fFechaHora(b.borrado_en)}</td>
                  <td>{b.borrado_por_nombre ?? "—"}</td>
                  <td>{b.motivo_borrado}</td>
                  <td>
                    <button className="boton-chico" disabled={restaurar.isPending} onClick={() => setARestaurar(b)} aria-label={`Restaurar ${b.folio}`}>
                      Restaurar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {aRestaurar && (
        <DialogoConfirmar
          titulo={`Restaurar ${aRestaurar.folio}`}
          texto={`Vuelve a verse en todas las pantallas como ${aRestaurar.estado}. Queda en la bitácora que fue borrado y restaurado.`}
          confirmar="Restaurar"
          onRespuesta={(si) => {
            const b = aRestaurar;
            setARestaurar(null);
            if (si) restaurar.mutate(b);
          }}
        />
      )}
    </div>
  );
}
