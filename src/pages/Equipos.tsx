import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { useEquipos } from "../lib/queries";
import { useUnidad, useUnidades } from "../lib/unidad";
import { useAvisos } from "../components/Avisos";
import type { Equipo } from "../lib/types";

// Catálogo de equipos (admin). Los equipos no se borran: se desactivan, porque
// pueden tener backlogs. El código interno es único dentro de la unidad.
type Campo = "cod_interno" | "cod_sap" | "marca" | "modelo" | "flota";
const NUEVO = { unidad_id: "", cod_interno: "", cod_sap: "", marca: "", modelo: "", flota: "" };

function mensaje(e: Error) {
  if (e.message.includes("equipos_unidad_cod_interno_key")) return "Ya existe un equipo con ese código interno en la unidad";
  return e.message;
}

export default function Equipos() {
  const qc = useQueryClient();
  const { avisar } = useAvisos();
  const { unidadId } = useUnidad();
  const { data: unidades } = useUnidades();
  const { data: equipos, isLoading } = useEquipos();
  const [buscar, setBuscar] = useState("");
  const [inactivos, setInactivos] = useState(false);
  const [nuevo, setNuevo] = useState(NUEVO);
  const nombreUnidad = (id: string) => unidades?.find((u) => u.id === id)?.nombre ?? "";
  const flotas = useMemo(() => [...new Set((equipos ?? []).map((e) => e.flota).filter((f): f is string => !!f))].sort(), [equipos]);
  const marcas = useMemo(() => [...new Set((equipos ?? []).map((e) => e.marca).filter((f): f is string => !!f))].sort(), [equipos]);

  const t = buscar.trim().toLowerCase();
  const visibles = (equipos ?? [])
    .filter((e) => inactivos || e.activo)
    .filter((e) => !t || `${e.cod_interno} ${e.cod_sap ?? ""} ${e.marca ?? ""} ${e.modelo} ${e.flota ?? ""}`.toLowerCase().includes(t))
    .sort((a, b) => nombreUnidad(a.unidad_id).localeCompare(nombreUnidad(b.unidad_id)) || (a.flota ?? "").localeCompare(b.flota ?? "") || a.cod_interno.localeCompare(b.cod_interno));

  const cambiar = useMutation({
    mutationFn: async ({ id, cambios }: { id: string; cambios: Partial<Equipo> }) => {
      const { error } = await supabase().from("equipos").update(cambios).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries(),
    onError: (e: Error) => {
      avisar(mensaje(e), "error");
      qc.invalidateQueries();
    },
  });

  const unidadNuevo = unidadId ?? nuevo.unidad_id;
  const crear = useMutation({
    mutationFn: async () => {
      const { error } = await supabase()
        .from("equipos")
        .insert({
          unidad_id: unidadNuevo,
          cod_interno: nuevo.cod_interno.trim(),
          cod_sap: nuevo.cod_sap.trim() || null,
          marca: nuevo.marca.trim() || null,
          modelo: nuevo.modelo.trim(),
          flota: nuevo.flota.trim() || null,
        });
      if (error) throw error;
    },
    onSuccess: () => {
      avisar(`Equipo ${nuevo.cod_interno.trim()} creado`);
      setNuevo({ ...NUEVO, unidad_id: nuevo.unidad_id });
      qc.invalidateQueries();
    },
    onError: (e: Error) => avisar(mensaje(e), "error"),
  });
  const nuevoValido = unidadNuevo && nuevo.cod_interno.trim() && nuevo.modelo.trim();

  const celda = (e: Equipo, campo: Campo, lista?: string) => (
    <input
      key={`${e.id}-${e[campo]}`}
      defaultValue={e[campo] ?? ""}
      list={lista}
      aria-label={`${campo} ${e.cod_interno}`}
      onBlur={(x) => {
        const v = x.target.value.trim();
        const valor = v === "" ? null : v;
        if (valor === (e[campo] ?? null)) return;
        if ((campo === "cod_interno" || campo === "modelo") && !valor) {
          avisar("El código interno y el modelo son obligatorios", "error");
          x.target.value = e[campo] ?? "";
          return;
        }
        cambiar.mutate({ id: e.id, cambios: { [campo]: valor } });
      }}
    />
  );

  return (
    <div className="pagina-formulario formato">
      <h1>Equipos</h1>
      <p className="subtitulo">
        Los cambios se graban al salir de cada celda. Un equipo que sale de operación se desactiva: deja de aparecer al registrar
        backlogs, pero conserva su historial.
      </p>

      <section className="panel-formulario">
        <h2 className="titulo-seccion">Nuevo equipo</h2>
        <div className="fila-campos">
          {!unidadId && (
            <label className="campo">
              <span>Unidad</span>
              <select value={nuevo.unidad_id} onChange={(e) => setNuevo({ ...nuevo, unidad_id: e.target.value })}>
                <option value="">Elegir…</option>
                {(unidades ?? []).filter((u) => u.activo).map((u) => (
                  <option key={u.id} value={u.id}>{u.nombre}</option>
                ))}
              </select>
            </label>
          )}
          <label className="campo"><span>Código interno</span><input value={nuevo.cod_interno} onChange={(e) => setNuevo({ ...nuevo, cod_interno: e.target.value })} placeholder="PS011" /></label>
          <label className="campo"><span>Equipo (flota)</span><input list="flotas" value={nuevo.flota} onChange={(e) => setNuevo({ ...nuevo, flota: e.target.value })} placeholder="Scoop" /></label>
          <label className="campo"><span>Marca</span><input list="marcas" value={nuevo.marca} onChange={(e) => setNuevo({ ...nuevo, marca: e.target.value })} placeholder="Epiroc" /></label>
          <label className="campo"><span>Modelo</span><input value={nuevo.modelo} onChange={(e) => setNuevo({ ...nuevo, modelo: e.target.value })} placeholder="ST1030" /></label>
          <label className="campo"><span>Código SAP</span><input value={nuevo.cod_sap} onChange={(e) => setNuevo({ ...nuevo, cod_sap: e.target.value })} /></label>
          <div style={{ alignSelf: "flex-end" }}>
            <button disabled={!nuevoValido || crear.isPending} onClick={() => crear.mutate()}>Crear</button>
          </div>
        </div>
      </section>

      <div className="barra-acciones">
        <input className="filtro-buscar" placeholder="Buscar código, marca, modelo o flota" value={buscar} onChange={(e) => setBuscar(e.target.value)} aria-label="Buscar equipo" />
        <label className="campo-check" style={{ margin: 0 }}>
          <input type="checkbox" checked={inactivos} onChange={(e) => setInactivos(e.target.checked)} />
          Mostrar inactivos
        </label>
        <div className="espacio" />
        <span className="nota">{visibles.length} equipo(s)</span>
      </div>
      <datalist id="flotas">{flotas.map((f) => <option key={f} value={f} />)}</datalist>
      <datalist id="marcas">{marcas.map((f) => <option key={f} value={f} />)}</datalist>

      {isLoading ? (
        <p className="nota">Cargando…</p>
      ) : (
        <div className="tabla-marco">
          <table className="tabla-edicion">
            <thead>
              <tr>
                {!unidadId && <th>Unidad</th>}
                <th>Código interno</th>
                <th>Equipo (flota)</th>
                <th>Marca</th>
                <th>Modelo</th>
                <th>Código SAP</th>
                <th className="centro">Activo</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((e) => (
                <tr key={e.id} className={e.activo ? undefined : "fila-inactiva"}>
                  {!unidadId && <td>{nombreUnidad(e.unidad_id)}</td>}
                  <td>{celda(e, "cod_interno")}</td>
                  <td>{celda(e, "flota", "flotas")}</td>
                  <td>{celda(e, "marca", "marcas")}</td>
                  <td>{celda(e, "modelo")}</td>
                  <td>{celda(e, "cod_sap")}</td>
                  <td className="centro">
                    <input
                      type="checkbox"
                      checked={e.activo}
                      aria-label={`Activo ${e.cod_interno}`}
                      onChange={(x) => cambiar.mutate({ id: e.id, cambios: { activo: x.target.checked } })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
