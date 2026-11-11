import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useBacklogs, useEspecialidades, usePerfiles } from "../../lib/queries";
import { useUnidades } from "../../lib/unidad";
import { usePreventivos } from "../../lib/preventivos";
import { imprimirPaquetes, ordenesDe, usePaquetes } from "../../lib/paquete";
import { useAvisos } from "../Avisos";
import { fFecha, fNum } from "../../lib/fmt";

export interface ClavePaquete {
  equipo_id: string;
  fecha: string;
}

// Imprime paquetes (equipo y día) con lo que ya está cargado en pantalla.
export function useImprimirPaquetes() {
  const qc = useQueryClient();
  const { avisar } = useAvisos();
  const { data: backlogs } = useBacklogs();
  const { data: preventivos } = usePreventivos();
  const { data: especialidades } = useEspecialidades();
  const { data: perfiles } = usePerfiles();
  const { data: unidades } = useUnidades();
  const [ocupado, setOcupado] = useState(false);

  async function imprimir(claves: ClavePaquete[]) {
    setOcupado(true);
    try {
      const { ruta, folios } = await imprimirPaquetes(claves, {
        backlogs: backlogs ?? [],
        preventivos: preventivos ?? [],
        especialidades: especialidades ?? [],
        perfiles: perfiles ?? [],
        nombreUnidad: (id) => unidades?.find((u) => u.id === id)?.nombre ?? "",
      });
      avisar(ruta ? `${folios.join(", ")} guardado en ${ruta}` : `${folios.join(", ")} listo para imprimir`);
      qc.invalidateQueries();
      return true;
    } catch (e) {
      avisar(`No se pudo armar el paquete: ${(e as Error).message}`, "error");
      return false;
    } finally {
      setOcupado(false);
    }
  }
  return { imprimir, ocupado, backlogs: backlogs ?? [], preventivos: preventivos ?? [] };
}

// Vista previa del paquete de un equipo y día, con el botón de imprimir.
export function DialogoPaquete({
  clave,
  puedeImprimir,
  onCerrar,
}: {
  clave: ClavePaquete;
  puedeImprimir: boolean;
  onCerrar: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  const { imprimir, ocupado, backlogs, preventivos } = useImprimirPaquetes();
  const { data: paquetes } = usePaquetes();
  const { preventivos: pms, correctivos } = ordenesDe(clave.equipo_id, clave.fecha, backlogs, preventivos);
  const existente = paquetes?.find((q) => q.equipo_id === clave.equipo_id && q.fecha === clave.fecha);
  const cod = pms[0]?.cod_interno ?? correctivos[0]?.cod_interno ?? existente?.cod_interno ?? "";
  const total = pms.length + correctivos.length;

  return (
    <dialog
      ref={ref}
      className="dialogo-ancho dialogo-paquete"
      onCancel={(e) => {
        e.preventDefault();
        onCerrar();
      }}
    >
      <h1 style={{ fontSize: 16 }}>
        Paquete de órdenes · {cod} · {fFecha(clave.fecha)}
      </h1>
      <p className="nota" style={{ marginTop: 0 }}>
        {existente
          ? `${existente.folio}, impreso ${existente.impresiones} vez(veces). `
          : "El número de paquete se asigna al imprimir. "}
        Entra todo lo programado para este equipo ese día. El PDF lleva la carátula, una hoja por preventivo y el formato de cada
        correctivo. La pauta de mantenimiento y el listado de filtros se imprimen aparte.
      </p>
      {total === 0 ? (
        <p className="nota">No hay órdenes programadas para este equipo ese día.</p>
      ) : (
        <div className="tabla-marco">
          <table className="tabla-ordenes-paquete">
            <thead>
              <tr>
                <th>N° OT</th>
                <th>Clase</th>
                <th>Folio</th>
                <th>Actividad</th>
                <th className="num">HH</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {pms.map((p) => (
                <tr key={p.id}>
                  <td>{p.n_ot}</td>
                  <td><span className="etiqueta-pm">Preventivo</span></td>
                  <td><Link to={`/preventivo/${p.id}`}>{p.folio}</Link></td>
                  <td>{p.actividad}</td>
                  <td className="num" />
                  <td>{p.estado}</td>
                </tr>
              ))}
              {correctivos.map((b) => (
                <tr key={b.id}>
                  <td>{b.ot_sap}</td>
                  <td>Correctivo</td>
                  <td><Link to={`/backlog/${b.id}`}>{b.folio}</Link></td>
                  <td>{b.descripcion}</td>
                  <td className="num">{fNum(b.hh_estimadas)}</td>
                  <td>{b.estado}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="barra-acciones" style={{ marginBottom: 0, marginTop: 12 }}>
        <div className="espacio" />
        <button className="boton-plano" onClick={onCerrar}>
          Cerrar
        </button>
        {puedeImprimir && (
          <button disabled={ocupado || total === 0} onClick={async () => (await imprimir([clave])) && onCerrar()}>
            {ocupado ? "Generando…" : "Imprimir paquete"}
          </button>
        )}
      </div>
    </dialog>
  );
}
