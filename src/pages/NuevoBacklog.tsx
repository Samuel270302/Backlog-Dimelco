import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { esOtro, sistemasDeEquipo, useBacklogs, useEquipos, useEspecialidades, useFamilias, useFamiliaSistemas, useSistemas } from "../lib/queries";
import { useUnidades, useUsaSap } from "../lib/unidad";
import { useAvisos } from "../components/Avisos";
import { marcarPendientes } from "../lib/pendientes";
import { hoyISO } from "../lib/fmt";
import { subirFotos } from "../lib/fotos";
import { BotonFotos, usePegarImagenes } from "../components/ficha/Fotos";
import { ORIGENES, PRIORIDADES, nombrePrioridad, TIPOS_PEDIDO, type Origen, type Prioridad, type TipoPedido } from "../lib/types";

// Registro con el orden del formato "Mantenimiento correctivo programado":
// encabezado y equipo, descripción del trabajo, repuestos, HH y justificación.

interface FilaRepuesto {
  numero_parte: string;
  cod_sap: string;
  cantidad: string;
  stock: string;
  descripcion: string;
  componente: string;
  observaciones: string;
}

interface FilaHh {
  especialidad_id: string;
  personas: string;
  horas: string;
}

const REPUESTO_VACIO: FilaRepuesto = {
  numero_parte: "",
  cod_sap: "",
  cantidad: "1",
  stock: "",
  descripcion: "",
  componente: "",
  observaciones: "",
};

function formularioVacio() {
  return {
    equipo_id: "",
    sistema_id: "",
    sistema_otro: "",
    origen: "Inspección" as Origen,
    tipo_pedido: "Normal" as TipoPedido,
    prioridad: "P3" as Prioridad,
    fecha_deteccion: hoyISO(),
    reportado_por: "",
    aprobado_por: "",
    aviso_sap: "",
    descripcion: "",
    componente: "",
    horometro: "",
    justificacion: "",
  };
}

const repuestoEnBlanco = (r: FilaRepuesto) =>
  !r.numero_parte.trim() && !r.cod_sap.trim() && !r.descripcion.trim() && !r.stock.trim() && !r.componente.trim() && !r.observaciones.trim();
const repuestoValido = (r: FilaRepuesto) => (r.numero_parte.trim() || r.cod_sap.trim()) && Number(r.cantidad) > 0 && (r.stock === "" || Number(r.stock) >= 0);
const numeroONull = (v: string) => (v.trim() === "" ? null : Number(v));

export default function NuevoBacklog() {
  const navegar = useNavigate();
  const qc = useQueryClient();
  const { avisar } = useAvisos();
  const { data: equipos } = useEquipos();
  const { data: sistemas } = useSistemas();
  const { data: familias } = useFamilias();
  const { data: relaciones } = useFamiliaSistemas();
  const usaSap = useUsaSap();
  const { data: especialidades } = useEspecialidades();
  const { data: unidades } = useUnidades();
  const { data: backlogs } = useBacklogs();
  const vacio = useMemo(() => formularioVacio(), []);
  const [f, setF] = useState(vacio);
  const [repuestos, setRepuestos] = useState<FilaRepuesto[]>([]);
  const [hh, setHh] = useState<FilaHh[]>([]);
  const [fotos, setFotos] = useState<File[]>([]);
  usePegarImagenes(true, (a) => setFotos((x) => [...x, ...a]));

  const sucio = JSON.stringify(f) !== JSON.stringify(vacio) || repuestos.length > 0 || hh.length > 0 || fotos.length > 0;
  useEffect(() => {
    marcarPendientes(sucio ? 1 : 0);
    return () => marcarPendientes(0);
  }, [sucio]);

  const varias = new Set((equipos ?? []).map((e) => e.unidad_id)).size > 1;
  const nombreUnidad = (id: string) => unidades?.find((u) => u.id === id)?.nombre ?? "";
  const nombreFamilia = (id: string | null) => familias?.find((x) => x.id === id)?.nombre ?? null;
  // Lista desplegable agrupada por familia (o flota escrita si aún no tiene familia).
  const gruposEquipos = useMemo(() => {
    const m = new Map<string, typeof equipos>();
    for (const e of (equipos ?? []).filter((x) => x.activo)) {
      const g = nombreFamilia(e.familia_id) ?? e.flota ?? "Sin familia";
      m.set(g, [...(m.get(g) ?? []), e]);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [equipos, familias]);
  const equipo = equipos?.find((e) => e.id === f.equipo_id);
  const sap = usaSap(equipo?.unidad_id);
  const sistemasEquipo = sistemasDeEquipo(equipo, sistemas, relaciones);
  const otro = esOtro(sistemas, f.sistema_id);
  // Al cambiar de equipo, el sistema elegido puede no ser de la familia nueva.
  useEffect(() => {
    if (f.sistema_id && !sistemasEquipo.some((s) => s.id === f.sistema_id)) setF((x) => ({ ...x, sistema_id: "" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.equipo_id, relaciones]);

  // Componentes ya usados, como sugerencia (backlogs y repuestos se escriben igual).
  const componentesUsados = useMemo(
    () => [...new Set((backlogs ?? []).map((b) => b.componente).filter((c): c is string => !!c))].sort(),
    [backlogs]
  );

  const repuestosCargados = repuestos.filter((r) => !repuestoEnBlanco(r));
  const hhValidas = hh.filter((h) => h.especialidad_id && Number(h.personas) > 0 && Number(h.horas) > 0);
  const faltantes: string[] = [];
  if (!f.equipo_id) faltantes.push("equipo");
  if (!f.sistema_id) faltantes.push("sistema");
  if (otro && !f.sistema_otro.trim()) faltantes.push("cuál es el sistema");
  if (!f.reportado_por.trim()) faltantes.push("quién reporta");
  if (!f.aprobado_por.trim()) faltantes.push("quién aprueba");
  if (f.descripcion.trim().length < 5) faltantes.push("descripción del trabajo (mínimo 5 letras)");
  if (!f.fecha_deteccion) faltantes.push("fecha");
  if (f.horometro !== "" && !(Number(f.horometro) >= 0)) faltantes.push("horómetro válido");
  if (repuestosCargados.some((r) => !repuestoValido(r)))
    faltantes.push("cada repuesto necesita número de parte o código, y cantidad");
  if (hh.length !== hhValidas.length) faltantes.push("completar o quitar las filas de HH");

  const grabar = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase()
        .from("backlogs")
        .insert({
          equipo_id: f.equipo_id,
          sistema_id: f.sistema_id,
          sistema_otro: otro ? f.sistema_otro.trim() : null,
          origen: f.origen,
          tipo_pedido: f.tipo_pedido,
          prioridad: f.prioridad,
          fecha_deteccion: f.fecha_deteccion,
          reportado_por: f.reportado_por.trim(),
          aprobado_por: f.aprobado_por.trim(),
          aviso_sap: sap ? f.aviso_sap.trim() || null : null,
          descripcion: f.descripcion.trim(),
          componente: f.componente.trim() || null,
          horometro: numeroONull(f.horometro),
          justificacion: f.justificacion.trim() || null,
        })
        .select("id, folio, unidad_id")
        .single();
      if (error) throw error;
      const creado = data as { id: string; folio: string; unidad_id: string };
      const fallas: string[] = [];
      if (repuestosCargados.length) {
        const { error: e } = await supabase()
          .from("backlog_repuestos")
          .insert(
            repuestosCargados.map((r, i) => ({
              backlog_id: creado.id,
              item: i + 1,
              numero_parte: r.numero_parte.trim() || null,
              cod_sap: sap ? r.cod_sap.trim() || null : null,
              cantidad: Number(r.cantidad),
              stock: numeroONull(r.stock),
              descripcion: r.descripcion.trim() || null,
              componente: r.componente.trim() || null,
              observaciones: r.observaciones.trim() || null,
            }))
          );
        if (e) fallas.push(`repuestos (${e.message})`);
      }
      if (hhValidas.length) {
        const { error: e } = await supabase()
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
        if (e) fallas.push(`HH (${e.message})`);
      }
      if (fotos.length) {
        const r = await subirFotos(creado, fotos);
        if (r.errores.length) fallas.push(`fotos (${r.errores.join("; ")})`);
      }
      return { ...creado, fallas };
    },
    onSuccess: (creado) => {
      marcarPendientes(0);
      qc.invalidateQueries();
      if (creado.fallas.length)
        avisar(`Backlog ${creado.folio} grabado, pero no se grabaron: ${creado.fallas.join("; ")}. Cárguelos en la ficha.`, "error");
      else avisar(`Backlog ${creado.folio} registrado`);
      navegar(`/backlog/${creado.id}`);
    },
    onError: (e: Error) => avisar(e.message, "error"),
  });

  const campo = <K extends keyof typeof vacio>(k: K, v: (typeof vacio)[K]) => setF((x) => ({ ...x, [k]: v }));
  const cambiarRepuesto = (i: number, k: keyof FilaRepuesto, v: string) =>
    setRepuestos((x) => x.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const cambiarHh = (i: number, k: keyof FilaHh, v: string) => setHh((x) => x.map((h, j) => (j === i ? { ...h, [k]: v } : h)));
  const especialidadesUsadas = new Set(hh.map((h) => h.especialidad_id));
  const totalHh = hhValidas.reduce((s, h) => s + Number(h.personas) * Number(h.horas), 0);

  return (
    <div className="pagina-formulario formato">
      <h1>Nuevo backlog</h1>
      <p className="subtitulo">Mantenimiento correctivo programado. Queda en estado Identificado hasta que el planificador lo apruebe.</p>

      <section className="panel-formulario">
        <h2 className="titulo-seccion">Equipo y pedido</h2>
        <label className="campo">
          <span>Equipo</span>
          <select aria-label="Equipo" value={f.equipo_id} onChange={(e) => campo("equipo_id", e.target.value)}>
            <option value="">Elegir equipo…</option>
            {gruposEquipos.map(([grupo, lista]) => (
              <optgroup key={grupo} label={grupo}>
                {(lista ?? []).map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.cod_interno} · {e.modelo}
                    {varias ? ` · ${nombreUnidad(e.unidad_id)}` : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {equipos && gruposEquipos.length === 0 && <span className="nota">No hay equipos activos.</span>}
        </label>
        {equipo && (
          <dl className="datos-fijos datos-equipo">
            <div><dt>Familia</dt><dd>{nombreFamilia(equipo.familia_id) ?? equipo.flota ?? "—"}</dd></div>
            <div><dt>Marca</dt><dd>{equipo.marca ?? "—"}</dd></div>
            <div><dt>Modelo</dt><dd>{equipo.modelo}</dd></div>
            <div><dt>Código interno</dt><dd>{equipo.cod_interno}</dd></div>
          </dl>
        )}

        <div className="fila-campos">
          <label className="campo">
            <span>Fecha</span>
            <input type="date" max={hoyISO()} value={f.fecha_deteccion} onChange={(e) => campo("fecha_deteccion", e.target.value)} />
          </label>
          <label className="campo">
            <span>Reportado por</span>
            <input value={f.reportado_por} onChange={(e) => campo("reportado_por", e.target.value)} placeholder="Quien reporta la necesidad" />
          </label>
          <label className="campo">
            <span>Aprobado por</span>
            <input value={f.aprobado_por} onChange={(e) => campo("aprobado_por", e.target.value)} placeholder="Quien la aprueba como backlog" />
          </label>
          <div className="campo">
            <span className="etiqueta-campo">Tipo de pedido</span>
            <div className="opciones-radio" role="radiogroup" aria-label="Tipo de pedido">
              {TIPOS_PEDIDO.map((t) => (
                <label key={t} className={`opcion-radio${f.tipo_pedido === t ? " activa" : ""}${t === "Urgente" ? " urgente" : ""}`}>
                  <input type="radio" name="tipo_pedido" checked={f.tipo_pedido === t} onChange={() => campo("tipo_pedido", t)} />
                  {t}
                </label>
              ))}
            </div>
          </div>
          <label className="campo">
            <span>Prioridad</span>
            <select value={f.prioridad} onChange={(e) => campo("prioridad", e.target.value as Prioridad)}>
              {PRIORIDADES.map((p) => (
                <option key={p} value={p}>{nombrePrioridad(p)}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="fila-campos">
          <label className="campo">
            <span>Sistema</span>
            <select aria-label="Sistema" value={f.sistema_id} onChange={(e) => campo("sistema_id", e.target.value)}>
              <option value="">Elegir…</option>
              {sistemasEquipo.map((s) => (
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
          {otro && (
            <label className="campo">
              <span>¿Cuál sistema?</span>
              <input value={f.sistema_otro} onChange={(e) => campo("sistema_otro", e.target.value)} />
            </label>
          )}
          {sap && (
            <label className="campo">
              <span>Aviso SAP (si existe)</span>
              <input value={f.aviso_sap} onChange={(e) => campo("aviso_sap", e.target.value)} />
            </label>
          )}
        </div>
      </section>

      <section className="panel-formulario">
        <h2 className="titulo-seccion">Trabajo</h2>
        <label className="campo">
          <span>Descripción del trabajo</span>
          <input
            value={f.descripcion}
            onChange={(e) => campo("descripcion", e.target.value)}
            placeholder="Ej.: Reempaque de block de implementos por fugas de aceite"
          />
        </label>
        <div className="fila-campos">
          <label className="campo">
            <span>Componente</span>
            <input
              list="componentes-usados"
              value={f.componente}
              onChange={(e) => campo("componente", e.target.value)}
              placeholder="Ej.: Block de implementos"
            />
          </label>
          <label className="campo">
            <span>Horómetro (h)</span>
            <input type="number" min={0} step="any" value={f.horometro} onChange={(e) => campo("horometro", e.target.value)} />
          </label>
        </div>
        <datalist id="componentes-usados">
          {componentesUsados.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </section>

      <section className="panel-formulario">
        <div className="barra-acciones" style={{ marginBottom: 8 }}>
          <h2 className="titulo-seccion">Repuestos</h2>
          <div className="espacio" />
          <button className="boton-secundario" onClick={() => setRepuestos((x) => [...x, { ...REPUESTO_VACIO }])}>
            Agregar repuesto
          </button>
        </div>
        {repuestos.length === 0 ? (
          <p className="nota">Sin repuestos. Si el trabajo no los necesita, deje esta sección vacía.</p>
        ) : (
          <div className="tabla-marco">
            <table className="tabla-edicion tabla-repuestos-formato">
              <thead>
                <tr>
                  <th className="num">Ítem</th>
                  <th>Número de parte</th>
                  {sap && <th>Código SAP</th>}
                  <th className="num">Cant/Req</th>
                  <th className="num">Stock</th>
                  <th>Descripción del repuesto</th>
                  <th>Componente/Sistema</th>
                  <th>Observaciones</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {repuestos.map((r, i) => (
                  <tr key={i}>
                    <td className="num">{i + 1}</td>
                    <td><input value={r.numero_parte} onChange={(e) => cambiarRepuesto(i, "numero_parte", e.target.value)} aria-label={`Número de parte ítem ${i + 1}`} /></td>
                    {sap && <td><input value={r.cod_sap} onChange={(e) => cambiarRepuesto(i, "cod_sap", e.target.value)} aria-label={`Código ítem ${i + 1}`} /></td>}
                    <td className="num"><input type="number" min={0.01} step="any" value={r.cantidad} onChange={(e) => cambiarRepuesto(i, "cantidad", e.target.value)} aria-label={`Cantidad ítem ${i + 1}`} /></td>
                    <td className="num"><input type="number" min={0} step="any" value={r.stock} onChange={(e) => cambiarRepuesto(i, "stock", e.target.value)} aria-label={`Stock ítem ${i + 1}`} /></td>
                    <td><input value={r.descripcion} onChange={(e) => cambiarRepuesto(i, "descripcion", e.target.value)} aria-label={`Descripción ítem ${i + 1}`} /></td>
                    <td><input list="componentes-usados" value={r.componente} onChange={(e) => cambiarRepuesto(i, "componente", e.target.value)} aria-label={`Componente ítem ${i + 1}`} /></td>
                    <td><input value={r.observaciones} onChange={(e) => cambiarRepuesto(i, "observaciones", e.target.value)} aria-label={`Observaciones ítem ${i + 1}`} /></td>
                    <td>
                      <button
                        className="boton-plano boton-quitar"
                        title="Quitar"
                        onClick={() => setRepuestos((x) => x.filter((_, j) => j !== i))}
                        aria-label={`Quitar ítem ${i + 1}`}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel-formulario">
        <div className="barra-acciones" style={{ marginBottom: 8 }}>
          <h2 className="titulo-seccion">Especialidades y HH</h2>
          <div className="espacio" />
          {hh.length > 0 && <strong>{totalHh} HH</strong>}
          <button
            className="boton-secundario"
            disabled={(especialidades ?? []).filter((e) => e.activo).every((e) => especialidadesUsadas.has(e.id))}
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
              <select value={h.especialidad_id} onChange={(e) => cambiarHh(i, "especialidad_id", e.target.value)}>
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
              <input type="number" min={1} step={1} value={h.personas} onChange={(e) => cambiarHh(i, "personas", e.target.value)} />
            </label>
            <label className="campo">
              <span>Horas</span>
              <input type="number" min={0.5} step={0.5} value={h.horas} onChange={(e) => cambiarHh(i, "horas", e.target.value)} />
            </label>
            <div className="hh-total">{Number(h.personas) * Number(h.horas) || 0} HH</div>
            <button className="boton-plano" onClick={() => setHh((x) => x.filter((_, j) => j !== i))}>
              Quitar
            </button>
          </div>
        ))}
      </section>

      <section className="panel-formulario">
        <div className="barra-acciones" style={{ marginBottom: 8 }}>
          <h2 className="titulo-seccion">Fotos</h2>
          <div className="espacio" />
          <span className="nota solo-escritorio">o pegar con Ctrl+V</span>
          <BotonFotos texto="Agregar fotos" etiqueta="Archivos de fotos" onArchivos={(a) => setFotos((x) => [...x, ...a])} />
        </div>
        {fotos.length === 0 ? (
          <p className="nota">Opcional. Las fotos de un repuesto en particular se agregan después en la ficha, pestaña Repuestos.</p>
        ) : (
          <ul className="lista-archivos">
            {fotos.map((a, i) => (
              <li key={`${a.name}-${i}`}>
                {a.name} <span className="nota">{Math.round(a.size / 1024)} KB</span>
                <button className="boton-plano boton-quitar" aria-label={`Quitar foto ${a.name}`} onClick={() => setFotos((x) => x.filter((_, j) => j !== i))}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel-formulario">
        <h2 className="titulo-seccion">Justificación</h2>
        <label className="campo">
          <span className="oculto-visual">Justificación</span>
          <textarea
            rows={3}
            value={f.justificacion}
            onChange={(e) => campo("justificacion", e.target.value)}
            placeholder="Por qué hay que hacer el trabajo y qué pasa si no se hace"
          />
        </label>
      </section>

      <div className="barra-acciones">
        {faltantes.length > 0 && <span className="nota">Falta: {faltantes.join(", ")}.</span>}
        <div className="espacio" />
        <button
          className="boton-plano"
          disabled={!sucio}
          onClick={() => {
            setF(vacio);
            setRepuestos([]);
            setHh([]);
            setFotos([]);
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
