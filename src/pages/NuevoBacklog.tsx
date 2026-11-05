import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { useEquipos, useEspecialidades, useSistemas } from "../lib/queries";
import { useUnidades } from "../lib/unidad";
import { useAvisos } from "../components/Avisos";
import { marcarPendientes } from "../lib/pendientes";
import { hoyISO } from "../lib/fmt";
import { ORIGENES, PRIORIDADES, type Origen, type Prioridad } from "../lib/types";

interface FilaHh {
  especialidad_id: string;
  personas: string;
  horas: string;
}

const VACIO = {
  equipo_id: "",
  sistema_id: "",
  origen: "Inspección" as Origen,
  prioridad: "P3" as Prioridad,
  fecha_deteccion: hoyISO(),
  reportado_por: "",
  aviso_sap: "",
  descripcion: "",
};

export default function NuevoBacklog() {
  const navegar = useNavigate();
  const qc = useQueryClient();
  const { avisar } = useAvisos();
  const { data: equipos } = useEquipos();
  const { data: sistemas } = useSistemas();
  const { data: especialidades } = useEspecialidades();
  const { data: unidades } = useUnidades();
  const [f, setF] = useState(VACIO);
  const [buscar, setBuscar] = useState("");
  const [hh, setHh] = useState<FilaHh[]>([]);

  const sucio = JSON.stringify(f) !== JSON.stringify(VACIO) || hh.length > 0;
  useEffect(() => {
    marcarPendientes(sucio ? 1 : 0);
    return () => marcarPendientes(0);
  }, [sucio]);

  const varias = new Set((equipos ?? []).map((e) => e.unidad_id)).size > 1;
  const nombreUnidad = (id: string) => unidades?.find((u) => u.id === id)?.nombre ?? "";
  const equiposVisibles = useMemo(() => {
    const t = buscar.trim().toLowerCase();
    return (equipos ?? [])
      .filter((e) => e.activo)
      .filter((e) => !t || `${e.cod_interno} ${e.modelo} ${e.cod_sap ?? ""}`.toLowerCase().includes(t));
  }, [equipos, buscar]);

  const hhValidas = hh.filter((h) => h.especialidad_id && Number(h.personas) > 0 && Number(h.horas) > 0);
  const hhIncompletas = hh.length !== hhValidas.length;
  const faltantes: string[] = [];
  if (!f.equipo_id) faltantes.push("equipo");
  if (!f.sistema_id) faltantes.push("sistema");
  if (f.descripcion.trim().length < 5) faltantes.push("descripción (mínimo 5 letras)");
  if (!f.fecha_deteccion) faltantes.push("fecha de detección");
  if (hhIncompletas) faltantes.push("completar o quitar las filas de HH");

  const grabar = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase()
        .from("backlogs")
        .insert({
          equipo_id: f.equipo_id,
          sistema_id: f.sistema_id,
          origen: f.origen,
          prioridad: f.prioridad,
          fecha_deteccion: f.fecha_deteccion,
          reportado_por: f.reportado_por.trim() || null,
          aviso_sap: f.aviso_sap.trim() || null,
          descripcion: f.descripcion.trim(),
        })
        .select("id, folio")
        .single();
      if (error) throw error;
      const creado = data as { id: string; folio: string };
      if (hhValidas.length) {
        const { error: e2 } = await supabase()
          .from("backlog_hh")
          .insert(
            hhValidas.map((h) => ({
              backlog_id: creado.id,
              especialidad_id: h.especialidad_id,
              tipo: "estimada",
              personas: Number(h.personas),
              horas: Number(h.horas),
            }))
          );
        if (e2) throw new Error(`Backlog ${creado.folio} grabado, pero las HH no: ${e2.message}`);
      }
      return creado;
    },
    onSuccess: (creado) => {
      marcarPendientes(0);
      qc.invalidateQueries();
      avisar(`Backlog ${creado.folio} registrado`);
      navegar(`/backlog/${creado.id}`);
    },
    onError: (e: Error) => avisar(e.message, "error"),
  });

  const campo = <K extends keyof typeof VACIO>(k: K, v: (typeof VACIO)[K]) => setF((x) => ({ ...x, [k]: v }));
  const especialidadesUsadas = new Set(hh.map((h) => h.especialidad_id));

  return (
    <div className="pagina-formulario">
      <h1>Nuevo backlog</h1>
      <p className="subtitulo">Queda en estado Identificado; el planificador lo revisa y lo aprueba.</p>

      <div className="panel-formulario">
        <label className="campo">
          <span>Equipo</span>
          <input
            placeholder="Buscar por código, modelo o código SAP"
            value={buscar}
            onChange={(e) => setBuscar(e.target.value)}
          />
        </label>
        <label className="campo">
          <span className="oculto-visual">Equipo elegido</span>
          <select
            value={f.equipo_id}
            onChange={(e) => campo("equipo_id", e.target.value)}
            size={Math.min(6, Math.max(2, equiposVisibles.length))}
          >
            {equiposVisibles.map((e) => (
              <option key={e.id} value={e.id}>
                {e.cod_interno} · {e.modelo}
                {varias ? ` · ${nombreUnidad(e.unidad_id)}` : ""}
              </option>
            ))}
          </select>
          {equipos && equiposVisibles.length === 0 && <span className="nota">Ningún equipo coincide.</span>}
        </label>

        <div className="fila-campos">
          <label className="campo">
            <span>Sistema</span>
            <select value={f.sistema_id} onChange={(e) => campo("sistema_id", e.target.value)}>
              <option value="">Elegir…</option>
              {(sistemas ?? []).filter((s) => s.activo).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </select>
          </label>
          <label className="campo">
            <span>Origen</span>
            <select value={f.origen} onChange={(e) => campo("origen", e.target.value as Origen)}>
              {ORIGENES.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </label>
          <label className="campo">
            <span>Prioridad propuesta</span>
            <select value={f.prioridad} onChange={(e) => campo("prioridad", e.target.value as Prioridad)}>
              {PRIORIDADES.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
        </div>

        <label className="campo">
          <span>Descripción del hallazgo</span>
          <textarea
            rows={3}
            value={f.descripcion}
            onChange={(e) => campo("descripcion", e.target.value)}
            placeholder="Qué se encontró, dónde y en qué condición (ej.: fuga en cilindro de levante izquierdo, sello dañado)"
          />
        </label>

        <div className="fila-campos">
          <label className="campo">
            <span>Fecha de detección</span>
            <input
              type="date"
              max={hoyISO()}
              value={f.fecha_deteccion}
              onChange={(e) => campo("fecha_deteccion", e.target.value)}
            />
          </label>
          <label className="campo">
            <span>Reportado por</span>
            <input value={f.reportado_por} onChange={(e) => campo("reportado_por", e.target.value)} placeholder="Nombre de quien lo vio" />
          </label>
          <label className="campo">
            <span>Aviso SAP (si existe)</span>
            <input value={f.aviso_sap} onChange={(e) => campo("aviso_sap", e.target.value)} />
          </label>
        </div>
      </div>

      <div className="panel-formulario">
        <div className="barra-acciones" style={{ marginBottom: 8 }}>
          <strong>HH estimadas (opcional)</strong>
          <div className="espacio" />
          <button
            className="boton-secundario"
            disabled={(especialidades ?? []).every((e) => especialidadesUsadas.has(e.id))}
            onClick={() => setHh((x) => [...x, { especialidad_id: "", personas: "1", horas: "" }])}
          >
            Agregar especialidad
          </button>
        </div>
        {hh.length === 0 && <p className="nota">Si no las conoce, el planificador las carga al aprobar.</p>}
        {hh.map((h, i) => (
          <div className="fila-campos fila-hh" key={i}>
            <label className="campo">
              <span>Especialidad</span>
              <select
                value={h.especialidad_id}
                onChange={(e) => setHh((x) => x.map((y, j) => (j === i ? { ...y, especialidad_id: e.target.value } : y)))}
              >
                <option value="">Elegir…</option>
                {(especialidades ?? [])
                  .filter((e) => e.activo && (e.id === h.especialidad_id || !especialidadesUsadas.has(e.id)))
                  .map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.nombre}
                    </option>
                  ))}
              </select>
            </label>
            <label className="campo">
              <span>Personas</span>
              <input
                type="number"
                min={1}
                step={1}
                value={h.personas}
                onChange={(e) => setHh((x) => x.map((y, j) => (j === i ? { ...y, personas: e.target.value } : y)))}
              />
            </label>
            <label className="campo">
              <span>Horas</span>
              <input
                type="number"
                min={0.5}
                step={0.5}
                value={h.horas}
                onChange={(e) => setHh((x) => x.map((y, j) => (j === i ? { ...y, horas: e.target.value } : y)))}
              />
            </label>
            <div className="hh-total">{Number(h.personas) * Number(h.horas) || 0} HH</div>
            <button className="boton-plano" onClick={() => setHh((x) => x.filter((_, j) => j !== i))}>
              Quitar
            </button>
          </div>
        ))}
      </div>

      <div className="barra-acciones">
        {faltantes.length > 0 && <span className="nota">Falta: {faltantes.join(", ")}.</span>}
        <div className="espacio" />
        <button
          className="boton-plano"
          disabled={!sucio}
          onClick={() => {
            setF(VACIO);
            setHh([]);
            setBuscar("");
          }}
        >
          Limpiar
        </button>
        <button disabled={faltantes.length > 0 || grabar.isPending} onClick={() => grabar.mutate()}>
          {grabar.isPending ? "Grabando…" : "Registrar backlog"}
        </button>
      </div>
    </div>
  );
}
