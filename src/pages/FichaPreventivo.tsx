import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth";
import { supabase } from "../lib/supabase";
import { usePerfiles } from "../lib/queries";
import { nombreUsuario } from "../lib/backlog";
import {
  ETIQUETA_ACCION,
  accionesPreventivo,
  useEventosPreventivo,
  useMaterialesPreventivo,
  usePreventivo,
} from "../lib/preventivos";
import { imprimirOtPreventivo } from "../lib/otPreventivo";
import { useAccionesPreventivo } from "../components/preventivos/AccionesPreventivo";
import { EtiquetaEstadoPreventivo } from "../components/preventivos/EtiquetaEstadoPreventivo";
import TablaMateriales from "../components/preventivos/TablaMateriales";
import { useAvisos } from "../components/Avisos";
import { fFecha, fFechaHora, fNum } from "../lib/fmt";
import type { Preventivo } from "../lib/types";

export default function FichaPreventivo() {
  const { id = "" } = useParams();
  const { esAdmin, puedeCapturar } = useAuth();
  const { avisar } = useAvisos();
  const qc = useQueryClient();
  const { data: p, isLoading } = usePreventivo(id);
  const { data: materiales } = useMaterialesPreventivo(id);
  const { data: eventos } = useEventosPreventivo(id);
  const { data: perfiles } = usePerfiles();
  const acciones = useAccionesPreventivo();
  const [imprimiendo, setImprimiendo] = useState(false);

  const editar = useMutation({
    mutationFn: async (cambios: Partial<Preventivo>) => {
      const { error } = await supabase().from("preventivos").update(cambios).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries(),
    onError: (e: Error) => {
      avisar(e.message, "error");
      qc.invalidateQueries();
    },
  });

  if (isLoading) return <div className="nota">Cargando…</div>;
  if (!p)
    return (
      <div>
        <h1>Preventivo no encontrado</h1>
        <p className="nota">
          No existe o es de otra unidad. <Link to="/preventivos">Volver</Link>
        </p>
      </div>
    );

  const editable = puedeCapturar && p.estado === "Programado";
  const materialesEditables = editable || (esAdmin && p.estado !== "Programado");

  async function imprimir() {
    if (!p) return;
    setImprimiendo(true);
    try {
      const ruta = await imprimirOtPreventivo(p, materiales ?? []);
      if (ruta) avisar(`Orden guardada en ${ruta}`);
    } catch (e) {
      avisar(`No se pudo generar la orden: ${(e as Error).message}`, "error");
    } finally {
      setImprimiendo(false);
    }
  }

  // Campo de texto que se graba al salir, solo con el preventivo Programado.
  const campo = (clave: "actividad" | "observaciones" | "n_ot", etiqueta: string, obligatorio = false) =>
    editable ? (
      <input
        key={`${clave}-${p[clave]}`}
        defaultValue={p[clave] ?? ""}
        aria-label={etiqueta}
        onBlur={(e) => {
          const v = e.target.value.trim();
          if (v === (p[clave] ?? "")) return;
          if (obligatorio && v.length < (clave === "actividad" ? 3 : 1)) {
            avisar(`${etiqueta}: no puede quedar vacío`, "error");
            e.target.value = p[clave] ?? "";
            return;
          }
          editar.mutate({ [clave]: v || null });
        }}
      />
    ) : (
      (p[clave] ?? "")
    );

  return (
    <div className="ficha-backlog ficha-preventivo">
      <div className="ficha-cabecera">
        <div>
          <div className="ficha-folio">
            {p.folio} <EtiquetaEstadoPreventivo estado={p.estado} /> <span className="etiqueta-pm">Preventivo</span>
          </div>
          <h1>
            {p.cod_interno} · {p.actividad}
          </h1>
          <p className="subtitulo">
            {[p.marca, p.modelo, p.flota].filter(Boolean).join(" · ")} · {p.unidad}
          </p>
        </div>
        <div className="ficha-acciones">
          <button className="boton-plano" disabled={imprimiendo} onClick={imprimir}>
            {imprimiendo ? "Generando…" : "Imprimir OT"}
          </button>
          {puedeCapturar && p.estado === "Ejecutado" && (
            <button className="boton-secundario" onClick={() => acciones.programar({ equipo_id: p.equipo_id, actividad: p.actividad })}>
              Programar el siguiente
            </button>
          )}
          {accionesPreventivo(p.estado, esAdmin, puedeCapturar).map((a) => (
            <button
              key={a}
              className={a === "ejecutar" ? undefined : a === "anular" ? "boton-plano boton-peligro-plano" : "boton-secundario"}
              onClick={() => acciones.abrir(p, a)}
            >
              {ETIQUETA_ACCION[a]}
            </button>
          ))}
        </div>
      </div>

      <div className="bloque-ficha">
        <h2>Datos</h2>
        <dl className="datos-fijos datos-preventivo">
          <div className="dato-ancho">
            <dt>Actividad</dt>
            <dd>{campo("actividad", "Actividad", true)}</dd>
          </div>
          <div>
            <dt>{p.usa_sap ? "OT SAP" : "N° OT"}</dt>
            <dd>{campo("n_ot", "N° de OT", true)}</dd>
          </div>
          <div>
            <dt>Fecha programada</dt>
            <dd>
              {fFecha(p.fecha_programada)}
              {p.reprogramaciones > 0 && <span className="nota"> · {p.reprogramaciones} reprogramación(es)</span>}
            </dd>
          </div>
          <div>
            <dt>Horómetro programado</dt>
            <dd>
              {editable ? (
                <input
                  key={`hp-${p.horometro_programado}`}
                  type="number"
                  min={0}
                  step="any"
                  defaultValue={p.horometro_programado ?? ""}
                  aria-label="Horómetro programado"
                  onBlur={(e) => {
                    const v = e.target.value.trim() === "" ? null : Number(e.target.value);
                    if (v === (p.horometro_programado === null ? null : Number(p.horometro_programado))) return;
                    if (v !== null && !(v >= 0)) {
                      avisar("El horómetro no puede ser negativo", "error");
                      return;
                    }
                    editar.mutate({ horometro_programado: v });
                  }}
                />
              ) : p.horometro_programado === null ? (
                ""
              ) : (
                `${fNum(p.horometro_programado)} h`
              )}
            </dd>
          </div>
          <div className="dato-ancho">
            <dt>Observaciones</dt>
            <dd>{campo("observaciones", "Observaciones")}</dd>
          </div>
          {p.estado === "Ejecutado" && (
            <>
              <div>
                <dt>Fecha de ejecución</dt>
                <dd>{fFecha(p.fecha_ejecucion)}</dd>
              </div>
              <div>
                <dt>Horómetro al ejecutar</dt>
                <dd>{p.horometro_ejecucion === null ? "" : `${fNum(p.horometro_ejecucion)} h`}</dd>
              </div>
              <div>
                <dt>Ejecutado por</dt>
                <dd>{p.ejecutado_por}</dd>
              </div>
              <div className="dato-ancho">
                <dt>Comentario de cierre</dt>
                <dd>{p.comentario_cierre}</dd>
              </div>
            </>
          )}
          {p.estado === "Anulado" && (
            <div className="dato-ancho">
              <dt>Motivo de la anulación</dt>
              <dd>{p.motivo_anulacion}</dd>
            </div>
          )}
        </dl>
        {editable && <p className="nota">Los cambios se graban al salir de cada campo. La fecha se cambia con Reprogramar.</p>}
      </div>

      <TablaMateriales
        preventivoId={p.id}
        filas={materiales ?? []}
        editable={materialesEditables}
        sap={p.usa_sap}
        nota={
          p.estado === "Programado"
            ? "Se pueden cargar antes o al marcar el preventivo como ejecutado."
            : materialesEditables
              ? `Preventivo ${p.estado}: solo el administrador cambia los materiales.`
              : `Preventivo ${p.estado}: los materiales no se editan.`
        }
      />

      <div className="bloque-ficha">
        <h2>Bitácora</h2>
        <ol className="bitacora">
          {[...(eventos ?? [])].reverse().map((e) => (
            <li key={e.id} className={`evento evento-${e.tipo === "reprogramación" ? "reprogramacion" : "estado"}`}>
              <div className="evento-cabecera">
                <span>{fFechaHora(e.creado_en)}</span>
                <span>{nombreUsuario(perfiles, e.usuario) || "Sistema"}</span>
              </div>
              <div className="evento-cambio">{e.tipo.charAt(0).toUpperCase() + e.tipo.slice(1)}</div>
              {e.texto && <div className="evento-texto">{e.texto}</div>}
            </li>
          ))}
        </ol>
      </div>
      {acciones.dialogo}
    </div>
  );
}
