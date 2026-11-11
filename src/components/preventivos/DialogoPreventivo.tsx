import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useEquipos, useFamilias } from "../../lib/queries";
import { useUnidades, useUsaSap } from "../../lib/unidad";
import { usePreventivos } from "../../lib/preventivos";
import { hoyISO } from "../../lib/fmt";

export interface BasePreventivo {
  equipo_id?: string;
  fecha?: string;
  actividad?: string;
}

// Programar un preventivo a mano: equipo, actividad y fecha. Las pautas y los kits no
// se cargan en la app. Fuera de las unidades con SAP, la app asigna el N° de OT.
export default function DialogoPreventivo({
  base,
  onCreado,
  onCerrar,
}: {
  base?: BasePreventivo;
  onCreado: (p: { id: string; folio: string; n_ot: string }) => void;
  onCerrar: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  const { data: equipos } = useEquipos();
  const { data: familias } = useFamilias();
  const { data: unidades } = useUnidades();
  const { data: preventivos } = usePreventivos();
  const usaSap = useUsaSap();
  const [equipoId, setEquipoId] = useState(base?.equipo_id ?? "");
  const [actividad, setActividad] = useState(base?.actividad ?? "");
  const [fecha, setFecha] = useState(base?.fecha ?? hoyISO());
  const [horometro, setHorometro] = useState("");
  const [ot, setOt] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");

  const varias = new Set((equipos ?? []).map((e) => e.unidad_id)).size > 1;
  const grupos = useMemo(() => {
    const m = new Map<string, NonNullable<typeof equipos>>();
    for (const e of (equipos ?? []).filter((x) => x.activo)) {
      const g = familias?.find((f) => f.id === e.familia_id)?.nombre ?? e.flota ?? "Sin familia";
      m.set(g, [...(m.get(g) ?? []), e]);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [equipos, familias]);
  const equipo = equipos?.find((e) => e.id === equipoId);
  const sap = usaSap(equipo?.unidad_id);
  // Actividades ya usadas, para no escribir distinto el mismo preventivo.
  const sugerencias = useMemo(() => [...new Set((preventivos ?? []).map((p) => p.actividad))].sort(), [preventivos]);

  const faltantes: string[] = [];
  if (!equipoId) faltantes.push("equipo");
  if (actividad.trim().length < 3) faltantes.push("actividad");
  if (!fecha) faltantes.push("fecha programada");
  if (sap && !ot.trim()) faltantes.push("OT SAP");
  if (horometro.trim() !== "" && !(Number(horometro) >= 0)) faltantes.push("horómetro válido");

  async function grabar() {
    setOcupado(true);
    setError("");
    const { data, error } = await supabase()
      .from("preventivos")
      .insert({
        equipo_id: equipoId,
        actividad: actividad.trim(),
        fecha_programada: fecha,
        horometro_programado: horometro.trim() === "" ? null : Number(horometro),
        n_ot: ot.trim() || null,
        observaciones: observaciones.trim() || null,
      })
      .select("id, folio, n_ot")
      .single();
    setOcupado(false);
    if (error) {
      setError(error.message);
      return;
    }
    onCreado(data as { id: string; folio: string; n_ot: string });
  }

  return (
    <dialog
      ref={ref}
      className="dialogo-preventivo"
      onCancel={(e) => {
        e.preventDefault();
        onCerrar();
      }}
    >
      <h1 style={{ fontSize: 16 }}>Programar preventivo</h1>
      <p className="nota" style={{ marginTop: 0 }}>
        La pauta de mantenimiento y el listado de filtros no se cargan aquí: se imprimen aparte y se entregan con la orden.
      </p>
      <label className="campo">
        <span>Equipo</span>
        <select aria-label="Equipo del preventivo" value={equipoId} onChange={(e) => setEquipoId(e.target.value)} autoFocus={!equipoId}>
          <option value="">Elegir equipo…</option>
          {grupos.map(([grupo, lista]) => (
            <optgroup key={grupo} label={grupo}>
              {lista.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.cod_interno} · {e.modelo}
                  {varias ? ` · ${unidades?.find((u) => u.id === e.unidad_id)?.nombre ?? ""}` : ""}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <label className="campo">
        <span>Actividad</span>
        <input
          value={actividad}
          onChange={(e) => setActividad(e.target.value)}
          placeholder="Ej.: PM 500 h motor diésel"
          list="actividades-preventivo"
          aria-label="Actividad del preventivo"
        />
        <datalist id="actividades-preventivo">
          {sugerencias.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </label>
      <div className="fila-campos">
        <label className="campo">
          <span>Fecha programada</span>
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} aria-label="Fecha programada del preventivo" />
        </label>
        <label className="campo">
          <span>Horómetro programado (opcional)</span>
          <input type="number" min={0} step="any" value={horometro} onChange={(e) => setHorometro(e.target.value)} aria-label="Horómetro programado" />
        </label>
      </div>
      <label className="campo">
        <span>{sap ? "OT SAP" : "N° OT (opcional)"}</span>
        <input
          value={ot}
          onChange={(e) => setOt(e.target.value)}
          placeholder={sap ? "Número de orden de SAP" : "Si se deja vacío, la app asigna el número"}
          aria-label="N° de OT del preventivo"
        />
      </label>
      <label className="campo">
        <span>Observaciones (opcional)</span>
        <textarea rows={2} value={observaciones} onChange={(e) => setObservaciones(e.target.value)} aria-label="Observaciones del preventivo" />
      </label>
      {faltantes.length > 0 && <p className="nota">Falta: {faltantes.join(", ")}.</p>}
      {error && <p className="texto-vencido">{error}</p>}
      <div className="barra-acciones" style={{ marginBottom: 0 }}>
        <div className="espacio" />
        <button className="boton-plano" onClick={onCerrar}>
          Cancelar
        </button>
        <button disabled={ocupado || faltantes.length > 0} onClick={grabar}>
          {ocupado ? "Grabando…" : "Programar"}
        </button>
      </div>
    </dialog>
  );
}
