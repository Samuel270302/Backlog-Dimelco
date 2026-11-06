import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAvisos } from "../Avisos";
import { fFecha, fNum } from "../../lib/fmt";
import type { BacklogRepuesto, EstadoRepuesto } from "../../lib/types";
import { BotonFotos } from "./Fotos";

const ESTADOS_REP: EstadoRepuesto[] = ["Por pedir", "Pedido", "Recibido"];
const NUEVO = {
  numero_parte: "",
  cod_sap: "",
  cantidad: "1",
  stock: "",
  descripcion: "",
  componente: "",
  observaciones: "",
  solicitud_sap: "",
  fecha_estimada: "",
};

// Columnas del formato (ítem, número de parte, código, cant/req, stock, descripción,
// componente/sistema, observaciones) más el seguimiento (SolPed, fecha, estado).
export default function TablaRepuestos({
  backlogId,
  filas,
  editable,
  fotosPorItem,
  onFotos,
  subiendo,
  sap = true,
}: {
  backlogId: string;
  sap?: boolean;
  filas: BacklogRepuesto[];
  editable: boolean;
  fotosPorItem?: Map<string, number>;
  onFotos?: (repuestoId: string, archivos: File[]) => void;
  subiendo?: boolean;
}) {
  const qc = useQueryClient();
  const { avisar } = useAvisos();
  const [nuevo, setNuevo] = useState(NUEVO);
  const ordenadas = [...filas].sort((a, b) => a.item - b.item);
  const pendientes = filas.filter((f) => f.estado !== "Recibido").length;

  const accion = useMutation({
    mutationFn: async (
      op: { tipo: "agregar" } | { tipo: "cambiar"; id: string; cambios: Partial<BacklogRepuesto> } | { tipo: "quitar"; id: string }
    ) => {
      const t = supabase().from("backlog_repuestos");
      const { error } =
        op.tipo === "agregar"
          ? await t.insert({
              backlog_id: backlogId,
              numero_parte: nuevo.numero_parte.trim() || null,
              cod_sap: nuevo.cod_sap.trim() || null,
              cantidad: Number(nuevo.cantidad),
              stock: nuevo.stock.trim() === "" ? null : Number(nuevo.stock),
              descripcion: nuevo.descripcion.trim() || null,
              componente: nuevo.componente.trim() || null,
              observaciones: nuevo.observaciones.trim() || null,
              solicitud_sap: nuevo.solicitud_sap.trim() || null,
              fecha_estimada: nuevo.fecha_estimada || null,
            })
          : op.tipo === "cambiar"
            ? await t.update(op.cambios).eq("id", op.id)
            : await t.delete().eq("id", op.id);
      if (error) throw error;
      return op.tipo;
    },
    onSuccess: (op) => {
      if (op === "agregar") setNuevo(NUEVO);
      qc.invalidateQueries();
    },
    onError: (e: Error) => {
      avisar(e.message, "error");
      qc.invalidateQueries();
    },
  });

  const valido = (nuevo.numero_parte.trim() || nuevo.cod_sap.trim()) && Number(nuevo.cantidad) > 0;
  const n = (k: keyof typeof NUEVO) => (e: React.ChangeEvent<HTMLInputElement>) => setNuevo((x) => ({ ...x, [k]: e.target.value }));

  // Texto editable que se graba al salir del campo.
  const textoEditable = (f: BacklogRepuesto, campo: "solicitud_sap" | "observaciones", etiqueta: string) =>
    editable ? (
      <input
        key={`${f.id}-${f[campo]}`}
        defaultValue={f[campo] ?? ""}
        aria-label={`${etiqueta} ítem ${f.item}`}
        onBlur={(e) => {
          const v = e.target.value.trim() || null;
          if (v !== f[campo]) accion.mutate({ tipo: "cambiar", id: f.id, cambios: { [campo]: v } });
        }}
      />
    ) : (
      f[campo]
    );

  return (
    <div className="bloque-ficha">
      <h2>
        Repuestos{" "}
        <span className="nota">
          {filas.length === 0 ? "sin repuestos" : `${filas.length} ítem(s), ${pendientes} sin recibir`}
        </span>
      </h2>
      <p className="nota">
        Al marcar como recibido el último repuesto, un backlog en «Esperando repuestos» pasa solo a «Listo para programar».
      </p>
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
              {sap && <th>SolPed / reserva</th>}
              <th>Fecha estimada</th>
              <th>Estado</th>
              <th>Recibido</th>
              <th>Fotos</th>
              {editable && <th />}
            </tr>
          </thead>
          <tbody>
            {ordenadas.map((f) => (
              <tr key={f.id} className={f.estado === "Recibido" ? "fila-recibida" : undefined}>
                <td className="num">{f.item}</td>
                <td>{f.numero_parte}</td>
                {sap && <td>{f.cod_sap}</td>}
                <td className="num">{fNum(f.cantidad, 2)}</td>
                <td className="num">{fNum(f.stock, 2)}</td>
                <td>{f.descripcion}</td>
                <td>{f.componente}</td>
                <td>{textoEditable(f, "observaciones", "Observaciones")}</td>
                {sap && <td>{textoEditable(f, "solicitud_sap", "Solicitud")}</td>}
                <td>
                  {editable ? (
                    <input
                      type="date"
                      value={f.fecha_estimada ?? ""}
                      aria-label={`Fecha estimada ítem ${f.item}`}
                      onChange={(e) => accion.mutate({ tipo: "cambiar", id: f.id, cambios: { fecha_estimada: e.target.value || null } })}
                    />
                  ) : (
                    fFecha(f.fecha_estimada)
                  )}
                </td>
                <td>
                  {editable ? (
                    <select
                      value={f.estado}
                      aria-label={`Estado ítem ${f.item}`}
                      onChange={(e) => accion.mutate({ tipo: "cambiar", id: f.id, cambios: { estado: e.target.value as EstadoRepuesto } })}
                    >
                      {ESTADOS_REP.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  ) : (
                    f.estado
                  )}
                </td>
                <td>{fFecha(f.fecha_recibido)}</td>
                <td className="celda-fotos">
                  <span className="nota">{fotosPorItem?.get(f.id) ?? 0}</span>
                  {editable && onFotos && (
                    <BotonFotos
                      plano
                      texto="+ Foto"
                      etiqueta={`Fotos ítem ${f.item}`}
                      ocupado={subiendo}
                      onArchivos={(a) => onFotos(f.id, a)}
                    />
                  )}
                </td>
                {editable && (
                  <td>
                    <button className="boton-plano" onClick={() => accion.mutate({ tipo: "quitar", id: f.id })}>
                      Quitar
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {editable && (
              <tr className="fila-nueva">
                <td className="num">{(ordenadas.at(-1)?.item ?? 0) + 1}</td>
                <td><input value={nuevo.numero_parte} onChange={n("numero_parte")} placeholder="N° de parte" aria-label="Número de parte nuevo" /></td>
                {sap && <td><input value={nuevo.cod_sap} onChange={n("cod_sap")} placeholder="Código" aria-label="Código nuevo" /></td>}
                <td className="num"><input type="number" min={0.01} step="any" value={nuevo.cantidad} onChange={n("cantidad")} aria-label="Cantidad nueva" /></td>
                <td className="num"><input type="number" min={0} step="any" value={nuevo.stock} onChange={n("stock")} aria-label="Stock nuevo" /></td>
                <td><input value={nuevo.descripcion} onChange={n("descripcion")} placeholder="Descripción" aria-label="Descripción nueva" /></td>
                <td><input value={nuevo.componente} onChange={n("componente")} aria-label="Componente nuevo" /></td>
                <td><input value={nuevo.observaciones} onChange={n("observaciones")} aria-label="Observaciones nuevas" /></td>
                {sap && <td><input value={nuevo.solicitud_sap} onChange={n("solicitud_sap")} aria-label="Solicitud nueva" /></td>}
                <td><input type="date" value={nuevo.fecha_estimada} onChange={n("fecha_estimada")} aria-label="Fecha estimada nueva" /></td>
                <td>Por pedir</td>
                <td />
                <td />
                <td>
                  <button disabled={!valido || accion.isPending} onClick={() => accion.mutate({ tipo: "agregar" })}>
                    Agregar
                  </button>
                </td>
              </tr>
            )}
            {!editable && filas.length === 0 && (
              <tr>
                <td colSpan={13} className="nota">Sin repuestos.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
