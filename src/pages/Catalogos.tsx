import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { useEspecialidades, useFamilias, useFamiliaSistemas, useSistemas } from "../lib/queries";
import { useAvisos } from "../components/Avisos";
import type { Catalogo } from "../lib/types";

// Sistemas y especialidades (admin). No se borran porque los usan backlogs y HH:
// se desactivan y dejan de aparecer en los formularios.
function TablaCatalogo({ tabla, titulo, filas, ayuda }: { tabla: "sistemas" | "especialidades" | "familias"; titulo: string; filas: Catalogo[]; ayuda: string }) {
  const qc = useQueryClient();
  const { avisar } = useAvisos();
  const [nuevo, setNuevo] = useState("");
  const ordenadas = [...filas].sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre));
  const error = (e: Error) => {
    avisar(e.message.includes("duplicate key") ? `Ya existe ese nombre en ${titulo.toLowerCase()}` : e.message, "error");
    qc.invalidateQueries();
  };

  const cambiar = useMutation({
    mutationFn: async ({ id, cambios }: { id: string; cambios: Partial<Catalogo> }) => {
      const { error } = await supabase().from(tabla).update(cambios).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries(),
    onError: error,
  });
  const crear = useMutation({
    mutationFn: async () => {
      const orden = Math.max(0, ...filas.filter((f) => f.orden < 99).map((f) => f.orden)) + 1;
      const { error } = await supabase().from(tabla).insert({ nombre: nuevo.trim(), orden });
      if (error) throw error;
    },
    onSuccess: () => {
      setNuevo("");
      qc.invalidateQueries();
    },
    onError: error,
  });

  return (
    <section className="bloque-ficha" aria-label={titulo}>
      <h2>{titulo}</h2>
      <p className="nota">{ayuda}</p>
      <div className="tabla-marco">
        <table className="tabla-edicion">
          <thead>
            <tr>
              <th>Nombre</th>
              <th className="num">Orden</th>
              <th className="centro">Activo</th>
            </tr>
          </thead>
          <tbody>
            {ordenadas.map((f) => (
              <tr key={f.id} className={f.activo ? undefined : "fila-inactiva"}>
                <td>
                  <input
                    key={`${f.id}-${f.nombre}`}
                    defaultValue={f.nombre}
                    aria-label={`Nombre ${f.nombre}`}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (!v) {
                        e.target.value = f.nombre;
                        return;
                      }
                      if (v !== f.nombre) cambiar.mutate({ id: f.id, cambios: { nombre: v } });
                    }}
                  />
                </td>
                <td className="num">
                  <input
                    key={`${f.id}-o${f.orden}`}
                    type="number"
                    defaultValue={f.orden}
                    aria-label={`Orden ${f.nombre}`}
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v) && v !== f.orden) cambiar.mutate({ id: f.id, cambios: { orden: v } });
                    }}
                  />
                </td>
                <td className="centro">
                  <input
                    type="checkbox"
                    checked={f.activo}
                    aria-label={`Activo ${f.nombre}`}
                    onChange={(e) => cambiar.mutate({ id: f.id, cambios: { activo: e.target.checked } })}
                  />
                </td>
              </tr>
            ))}
            <tr className="fila-nueva">
              <td>
                <input value={nuevo} onChange={(e) => setNuevo(e.target.value)} placeholder="Nombre nuevo" aria-label={`Nuevo en ${titulo}`} />
              </td>
              <td />
              <td className="centro">
                <button className="boton-chico" disabled={!nuevo.trim() || crear.isPending} onClick={() => crear.mutate()}>
                  Agregar
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

// Sistemas de cada familia: los que se ofrecen al registrar un backlog de un equipo de
// esa familia. "Otro" se ofrece siempre y no se marca aquí.
function SistemasPorFamilia({ familias, sistemas }: { familias: Catalogo[]; sistemas: Catalogo[] }) {
  const qc = useQueryClient();
  const { avisar } = useAvisos();
  const { data: relaciones } = useFamiliaSistemas();
  const activas = familias.filter((f) => f.activo).sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre));
  const [familiaId, setFamiliaId] = useState("");
  const elegida = activas.find((f) => f.id === familiaId) ?? activas[0];
  const marcados = new Set((relaciones ?? []).filter((r) => r.familia_id === elegida?.id).map((r) => r.sistema_id));
  const lista = sistemas.filter((s) => s.activo && s.nombre !== "Otro").sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre));

  const marcar = useMutation({
    mutationFn: async ({ sistemaId, si }: { sistemaId: string; si: boolean }) => {
      const t = supabase().from("familia_sistemas");
      const { error } = si
        ? await t.insert({ familia_id: elegida!.id, sistema_id: sistemaId })
        : await t.delete().eq("familia_id", elegida!.id).eq("sistema_id", sistemaId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries(),
    onError: (e: Error) => {
      avisar(e.message, "error");
      qc.invalidateQueries();
    },
  });

  return (
    <section className="bloque-ficha" aria-label="Sistemas por familia">
      <h2>Sistemas por familia</h2>
      <p className="nota">
        Al registrar un backlog solo aparecen los sistemas marcados para la familia del equipo, más «Otro». Una familia sin
        sistemas marcados muestra todos.
      </p>
      {activas.length === 0 ? (
        <p className="nota">Primero cree las familias.</p>
      ) : (
        <>
          <label className="campo" style={{ maxWidth: 320 }}>
            <span>Familia</span>
            <select value={elegida?.id ?? ""} onChange={(e) => setFamiliaId(e.target.value)}>
              {activas.map((f) => (
                <option key={f.id} value={f.id}>{f.nombre}</option>
              ))}
            </select>
          </label>
          <div className="lista-casillas">
            {lista.map((s) => (
              <label key={s.id} className="campo-check">
                <input
                  type="checkbox"
                  checked={marcados.has(s.id)}
                  disabled={marcar.isPending}
                  onChange={(e) => marcar.mutate({ sistemaId: s.id, si: e.target.checked })}
                />
                {s.nombre}
              </label>
            ))}
          </div>
          <p className="nota">{marcados.size} sistema(s) marcados para {elegida?.nombre}.</p>
        </>
      )}
    </section>
  );
}

export default function Catalogos() {
  const { data: sistemas } = useSistemas();
  const { data: especialidades } = useEspecialidades();
  const { data: familias } = useFamilias();
  return (
    <div className="pagina-formulario">
      <h1>Familias, sistemas y especialidades</h1>
      <p className="subtitulo">Los cambios se graban al salir de cada celda. Desactivar no afecta a los backlogs que ya los usan.</p>
      <div className="rejilla-catalogos">
        <TablaCatalogo
          tabla="familias"
          titulo="Familias de equipo"
          filas={familias ?? []}
          ayuda="Grupo de equipos con los mismos sistemas (Scooptram ST1030, PowerROC T35…). Cada equipo se asigna a su familia en Equipos."
        />
        <SistemasPorFamilia familias={familias ?? []} sistemas={sistemas ?? []} />
        <TablaCatalogo tabla="sistemas" titulo="Sistemas" filas={sistemas ?? []} ayuda="Sistema del equipo donde está el trabajo (motor, hidráulico, frenos…)." />
        <TablaCatalogo
          tabla="especialidades"
          titulo="Especialidades"
          filas={especialidades ?? []}
          ayuda="Oficios con los que se estiman y registran las HH. Cada una necesita su capacidad en Capacidad del taller."
        />
      </div>
    </div>
  );
}
