import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { usePerfiles } from "../../lib/queries";
import { nombreUsuario } from "../../lib/backlog";
import { useAvisos } from "../Avisos";
import { fFechaHora } from "../../lib/fmt";
import type { BacklogEvento } from "../../lib/types";

export default function Bitacora({
  backlogId,
  eventos,
  puedeComentar,
}: {
  backlogId: string;
  eventos: BacklogEvento[];
  puedeComentar: boolean;
}) {
  const qc = useQueryClient();
  const { avisar } = useAvisos();
  const { data: perfiles } = usePerfiles();
  const [texto, setTexto] = useState("");

  const comentar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase()
        .from("backlog_eventos")
        .insert({ backlog_id: backlogId, tipo: "comentario", texto: texto.trim() });
      if (error) throw error;
    },
    onSuccess: () => {
      setTexto("");
      qc.invalidateQueries();
    },
    onError: (e: Error) => avisar(e.message, "error"),
  });

  return (
    <div className="bloque-ficha">
      <h2>Bitácora</h2>
      <ol className="bitacora">
        {[...eventos].reverse().map((e) => (
          <li key={e.id} className={`evento evento-${e.tipo === "reprogramación" ? "reprogramacion" : e.tipo}`}>
            <div className="evento-cabecera">
              <span>{fFechaHora(e.creado_en)}</span>
              <span>{nombreUsuario(perfiles, e.usuario) || "Sistema"}</span>
            </div>
            {e.estado_nuevo && (
              <div className="evento-cambio">
                {e.estado_anterior ? `${e.estado_anterior} → ${e.estado_nuevo}` : e.estado_nuevo}
                {e.tipo === "reprogramación" && " (reprogramación)"}
              </div>
            )}
            {e.texto && <div className="evento-texto">{e.texto}</div>}
          </li>
        ))}
      </ol>
      {puedeComentar && (
        <div className="comentar">
          <textarea
            rows={2}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Agregar comentario (avance, coordinación, observación)"
            aria-label="Comentario"
          />
          <button disabled={texto.trim().length < 2 || comentar.isPending} onClick={() => comentar.mutate()}>
            Comentar
          </button>
        </div>
      )}
    </div>
  );
}
