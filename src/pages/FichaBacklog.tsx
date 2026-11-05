import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth";
import { useEspecialidades, usePerfiles } from "../lib/queries";
import { useUnidades } from "../lib/unidad";
import { imprimirFormato } from "../lib/formato";
import {
  ESTADOS_FINALES,
  cambiarEstado,
  transiciones,
  useBacklog,
  useEventosBacklog,
  useHhBacklog,
  useRepuestosBacklog,
  type Transicion,
} from "../lib/backlog";
import { EtiquetaEstado, EtiquetaPrioridad } from "../components/Etiquetas";
import DialogoTransicion from "../components/DialogoTransicion";
import DatosBacklog from "../components/ficha/DatosBacklog";
import TablaHh from "../components/ficha/TablaHh";
import TablaRepuestos from "../components/ficha/TablaRepuestos";
import Bitacora from "../components/ficha/Bitacora";
import { useAvisos } from "../components/Avisos";
import { fNum } from "../lib/fmt";

type Pestania = "datos" | "hh" | "repuestos" | "fotos" | "bitacora";

export default function FichaBacklog() {
  const { id = "" } = useParams();
  const { esAdmin, puedeCapturar } = useAuth();
  const qc = useQueryClient();
  const { avisar } = useAvisos();
  const { data: b, isLoading } = useBacklog(id);
  const { data: hh } = useHhBacklog(id);
  const { data: repuestos } = useRepuestosBacklog(id);
  const { data: eventos } = useEventosBacklog(id);
  const { data: especialidades } = useEspecialidades();
  const { data: perfiles } = usePerfiles();
  const { data: unidades } = useUnidades();
  const [imprimiendo, setImprimiendo] = useState(false);
  const [pestania, setPestania] = useState<Pestania>("datos");
  const [transicion, setTransicion] = useState<Transicion | null>(null);
  const [ocupado, setOcupado] = useState(false);

  if (isLoading) return <div className="nota">Cargando…</div>;
  if (!b)
    return (
      <div>
        <h1>Backlog no encontrado</h1>
        <p className="nota">No existe o es de otra unidad. <Link to="/backlog">Volver al tablero</Link></p>
      </div>
    );

  const final = ESTADOS_FINALES.includes(b.estado);
  const datosEditables = esAdmin ? !final : puedeCapturar && b.estado === "Identificado";
  const detalleEditable = puedeCapturar && !final;
  const estimadasEditables = detalleEditable && b.estado !== "Ejecutado";
  const realesEditables = detalleEditable && (b.estado === "Programado" || b.estado === "Ejecutado");
  const acciones = transiciones(b.estado).filter((t) => esAdmin || (puedeCapturar && !t.soloAdmin));
  const hhEst = (hh ?? []).filter((h) => h.tipo === "estimada");
  const hhReal = (hh ?? []).filter((h) => h.tipo === "real");

  async function aplicar(datos: Record<string, unknown>) {
    if (!transicion || !b) return;
    setOcupado(true);
    try {
      await cambiarEstado(b.id, transicion.destino, datos);
      avisar(`${b.folio}: ${transicion.destino}`);
      setTransicion(null);
      qc.invalidateQueries();
    } catch (e) {
      avisar((e as Error).message, "error");
    } finally {
      setOcupado(false);
    }
  }

  async function imprimir() {
    if (!b) return;
    setImprimiendo(true);
    try {
      const ruta = await imprimirFormato({
        b,
        repuestos: repuestos ?? [],
        hh: hh ?? [],
        especialidades: especialidades ?? [],
        eventos: eventos ?? [],
        perfiles: perfiles ?? [],
        unidad: unidades?.find((u) => u.id === b.unidad_id)?.nombre ?? "",
      });
      if (ruta) avisar(`Formato guardado en ${ruta}`);
    } catch (e) {
      avisar(`No se pudo generar el formato: ${(e as Error).message}`, "error");
    } finally {
      setImprimiendo(false);
    }
  }

  const pestanias: [Pestania, string][] = [
    ["datos", "Datos"],
    ["hh", `HH (${fNum(b.hh_estimadas)} est. / ${fNum(b.hh_reales)} real)`],
    [
      "repuestos",
      b.repuestos_total === 0
        ? "Repuestos"
        : `Repuestos (${b.repuestos_total}${b.repuestos_pendientes ? `, ${b.repuestos_pendientes} sin recibir` : ""})`,
    ],
    ["fotos", "Fotos"],
    ["bitacora", `Bitácora (${eventos?.length ?? 0})`],
  ];

  return (
    <div className="ficha-backlog">
      <div className="ficha-cabecera">
        <div>
          <div className="ficha-folio">
            {b.folio} <EtiquetaEstado estado={b.estado} /> <EtiquetaPrioridad prioridad={b.prioridad} />
            {b.tipo_pedido === "Urgente" && <span className="etiqueta-urgente">Urgente</span>}
          </div>
          <h1>
            {b.cod_interno} · {b.sistema}
            {b.componente ? ` · ${b.componente}` : ""}
          </h1>
          <p className="subtitulo">{b.descripcion}</p>
        </div>
        <div className="ficha-acciones">
          <button className="boton-plano" disabled={imprimiendo} onClick={imprimir}>
            {imprimiendo ? "Generando…" : "Imprimir formato"}
          </button>
          {acciones.map((t) => (
            <button
              key={t.destino}
              className={t.peligro ? "boton-plano boton-peligro-plano" : undefined}
              onClick={() => setTransicion(t)}
            >
              {t.etiqueta}
            </button>
          ))}
        </div>
      </div>

      <div className="pestanias" role="tablist">
        {pestanias.map(([k, t]) => (
          <button
            key={k}
            role="tab"
            aria-selected={pestania === k}
            className={`pestania${pestania === k ? " activa" : ""}`}
            onClick={() => setPestania(k)}
          >
            {t}
          </button>
        ))}
      </div>

      {pestania === "datos" && <DatosBacklog b={b} editable={datosEditables} />}
      {pestania === "hh" && (
        <div className="fila-tablas-ficha">
          <TablaHh
            backlogId={b.id}
            tipo="estimada"
            filas={hhEst}
            especialidades={especialidades ?? []}
            editable={estimadasEditables}
            motivoBloqueo={b.estado === "Ejecutado" ? "Con el backlog ejecutado ya no se cambian las HH estimadas." : undefined}
          />
          <TablaHh
            backlogId={b.id}
            tipo="real"
            filas={hhReal}
            especialidades={especialidades ?? []}
            editable={realesEditables}
            motivoBloqueo={!final ? "Las HH reales se cargan cuando el backlog está Programado o Ejecutado." : undefined}
          />
        </div>
      )}
      {pestania === "repuestos" && <TablaRepuestos backlogId={b.id} filas={repuestos ?? []} editable={detalleEditable} />}
      {pestania === "fotos" && (
        <div className="bloque-ficha">
          <p className="nota">Las fotos se agregan cuando esté lista la versión web, con la cámara del celular.</p>
        </div>
      )}
      {pestania === "bitacora" && <Bitacora backlogId={b.id} eventos={eventos ?? []} puedeComentar={puedeCapturar} />}

      {transicion && (
        <DialogoTransicion
          folio={b.folio}
          transicion={transicion}
          prioridadActual={b.prioridad}
          otActual={b.ot_sap}
          ocupado={ocupado}
          onAceptar={aplicar}
          onCerrar={() => setTransicion(null)}
        />
      )}
    </div>
  );
}
