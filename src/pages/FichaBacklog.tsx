import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { useDialogoMotivo } from "../components/DialogoMotivo";
import { useAuth } from "../auth";
import { useEspecialidades, usePerfiles } from "../lib/queries";
import { useUnidades } from "../lib/unidad";
import { imprimirFormato } from "../lib/formato";
import { useFotosBacklog } from "../lib/fotos";
import Fotos, { useSubirFotos } from "../components/ficha/Fotos";
import { ESTADOS_FINALES, useBacklog, useEventosBacklog, useHhBacklog, useRepuestosBacklog } from "../lib/backlog";
import { useCambioEstado, useTransicionesPermitidas } from "../components/CambioEstado";
import { EtiquetaEstado, EtiquetaPrioridad } from "../components/Etiquetas";
import DatosBacklog from "../components/ficha/DatosBacklog";
import BarraAvance from "../components/BarraAvance";
import TablaHh from "../components/ficha/TablaHh";
import TablaRepuestos from "../components/ficha/TablaRepuestos";
import Bitacora from "../components/ficha/Bitacora";
import { useAvisos } from "../components/Avisos";
import { fNum } from "../lib/fmt";

type Pestania = "datos" | "hh" | "repuestos" | "fotos" | "bitacora";

export default function FichaBacklog() {
  const { id = "" } = useParams();
  const { esAdmin, puedeCapturar } = useAuth();
  const { avisar } = useAvisos();
  const permitidas = useTransicionesPermitidas();
  const cambio = useCambioEstado();
  const { data: b, isLoading } = useBacklog(id);
  const { data: hh } = useHhBacklog(id);
  const { data: repuestos } = useRepuestosBacklog(id);
  const { data: eventos } = useEventosBacklog(id);
  const { data: especialidades } = useEspecialidades();
  const { data: perfiles } = usePerfiles();
  const { data: fotos } = useFotosBacklog(id);
  const { data: unidades } = useUnidades();
  const [imprimiendo, setImprimiendo] = useState(false);
  const subidaFotos = useSubirFotos({ id, unidad_id: b?.unidad_id ?? "" });
  const [pestania, setPestania] = useState<Pestania>("datos");
  const [borrando, setBorrando] = useState(false);
  const { pedirMotivo, dialogo: dialogoBorrar } = useDialogoMotivo();
  const navegar = useNavigate();
  const qc = useQueryClient();

  if (isLoading) return <div className="nota">Cargando…</div>;
  if (!b)
    return (
      <div>
        <h1>Backlog no encontrado</h1>
        <p className="nota">
          No existe, es de otra unidad o fue borrado.{esAdmin && <> Los borrados están en <Link to="/borrados">Backlogs borrados</Link>.</>}{" "}
          <Link to="/flota">Volver</Link>
        </p>
      </div>
    );

  const final = ESTADOS_FINALES.includes(b.estado);
  const datosEditables = puedeCapturar && !final;
  const detalleEditable = puedeCapturar && !final;
  const estimadasEditables = detalleEditable && b.estado !== "Ejecutado";
  const realesEditables = detalleEditable && (b.estado === "Programado" || b.estado === "Ejecutado");
  const acciones = permitidas(b.estado);
  const hhEst = (hh ?? []).filter((h) => h.tipo === "estimada");
  const hhReal = (hh ?? []).filter((h) => h.tipo === "real");

  async function imprimir() {
    if (!b) return;
    setImprimiendo(true);
    try {
      const ruta = await imprimirFormato({
        b,
        repuestos: repuestos ?? [],
        fotos: fotos ?? [],
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

  // Borrar: admin o capturador de la unidad, en cualquier estado, con motivo. El backlog
  // se oculta de todas las pantallas; el admin lo restaura desde Backlogs borrados.
  async function borrar() {
    if (!b) return;
    const motivo = await pedirMotivo(
      `Borrar ${b.folio}`,
      "El backlog deja de verse en todas las pantallas, indicadores y reportes. El administrador puede restaurarlo.",
      { etiqueta: "Motivo del borrado", boton: "Borrar", ejemplo: "Ej.: registrado dos veces, equipo equivocado" }
    );
    if (!motivo) return;
    setBorrando(true);
    const { error } = await supabase().rpc("borrar_backlog", { p_id: b.id, p_motivo: motivo });
    setBorrando(false);
    if (error) {
      avisar(error.message, "error");
      return;
    }
    avisar(`${b.folio} borrado`);
    qc.invalidateQueries();
    navegar("/flota");
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
    ["fotos", `Fotos (${fotos?.length ?? 0})`],
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
          <BarraAvance b={b} eventos={eventos ?? []} detallada />
        </div>
        <div className="ficha-acciones">
          <button className="boton-plano" disabled={imprimiendo} onClick={imprimir}>
            {imprimiendo ? "Generando…" : "Imprimir formato"}
          </button>
          {(esAdmin || (puedeCapturar && b.estado !== "Validado")) && (
            <button className="boton-plano boton-peligro-plano" disabled={borrando} onClick={borrar}>
              {borrando ? "Borrando…" : "Borrar"}
            </button>
          )}
          {acciones.map((t) => (
            <button
              key={t.destino}
              className={t.peligro ? "boton-plano boton-peligro-plano" : t.atras ? "boton-secundario" : undefined}
              onClick={() => cambio.abrir(b, t)}
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
      {pestania === "repuestos" && (
        <TablaRepuestos
          backlogId={b.id}
          sap={b.usa_sap}
          filas={repuestos ?? []}
          editable={detalleEditable}
          fotosPorItem={new Map((repuestos ?? []).map((r) => [r.id, (fotos ?? []).filter((f) => f.repuesto_id === r.id).length]))}
          onFotos={(repuestoId, archivos) => subidaFotos.subir(archivos, repuestoId)}
          subiendo={subidaFotos.subiendo}
        />
      )}
      {pestania === "fotos" && <Fotos b={b} fotos={fotos ?? []} repuestos={repuestos ?? []} editable={detalleEditable} />}
      {pestania === "bitacora" && <Bitacora backlogId={b.id} eventos={eventos ?? []} puedeComentar={puedeCapturar} />}

      {cambio.dialogo}
      {dialogoBorrar}
    </div>
  );
}
