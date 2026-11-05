import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAvisos } from "../Avisos";
import { fFecha, fNum } from "../../lib/fmt";
import type { BacklogRepuesto, EstadoRepuesto } from "../../lib/types";

const ESTADOS_REP: EstadoRepuesto[] = ["Por pedir", "Pedido", "Recibido"];
const NUEVO = { cod_sap: "", descripcion: "", cantidad: "1", um: "UN", solicitud_sap: "", fecha_estimada: "" };

export default function TablaRepuestos({
  backlogId,
  filas,
  editable,
}: {
  backlogId: string;
  filas: BacklogRepuesto[];
  editable: boolean;
}) {
  const qc = useQueryClient();
  const { avisar } = useAvisos();
  const [nuevo, setNuevo] = useState(NUEVO);
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
              cod_sap: nuevo.cod_sap.trim(),
              descripcion: nuevo.descripcion.trim() || null,
              cantidad: Number(nuevo.cantidad),
              um: nuevo.um.trim() || "UN",
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

  const valido = nuevo.cod_sap.trim() && Number(nuevo.cantidad) > 0;
  const n = (k: keyof typeof NUEVO) => (e: React.ChangeEvent<HTMLInputElement>) => setNuevo((x) => ({ ...x, [k]: e.target.value }));

  return (
    <div className="bloque-ficha">
      <h2>
        Repuestos{" "}
        <span className="nota">
          {filas.length === 0 ? "sin repuestos" : `${filas.length} línea(s), ${pendientes} sin recibir`}
        </span>
      </h2>
      <p className="nota">
        Al marcar como recibido el último repuesto, un backlog en «Esperando repuestos» pasa solo a «Listo para programar».
      </p>
      <div className="tabla-marco">
        <table className="tabla-edicion">
          <thead>
            <tr>
              <th>Código SAP</th>
              <th>Descripción</th>
              <th className="num">Cantidad</th>
              <th>UM</th>
              <th>SolPed / reserva</th>
              <th>Fecha estimada</th>
              <th>Estado</th>
              <th>Recibido</th>
              {editable && <th />}
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.id} className={f.estado === "Recibido" ? "fila-recibida" : undefined}>
                <td>{f.cod_sap}</td>
                <td>{f.descripcion}</td>
                <td className="num">{fNum(f.cantidad, 2)}</td>
                <td>{f.um}</td>
                <td>
                  {editable ? (
                    <input
                      key={`${f.id}-${f.solicitud_sap}`}
                      defaultValue={f.solicitud_sap ?? ""}
                      aria-label={`Solicitud ${f.cod_sap}`}
                      onBlur={(e) => {
                        const v = e.target.value.trim() || null;
                        if (v !== f.solicitud_sap) accion.mutate({ tipo: "cambiar", id: f.id, cambios: { solicitud_sap: v } });
                      }}
                    />
                  ) : (
                    f.solicitud_sap
                  )}
                </td>
                <td>
                  {editable ? (
                    <input
                      type="date"
                      value={f.fecha_estimada ?? ""}
                      aria-label={`Fecha estimada ${f.cod_sap}`}
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
                      aria-label={`Estado ${f.cod_sap}`}
                      onChange={(e) =>
                        accion.mutate({ tipo: "cambiar", id: f.id, cambios: { estado: e.target.value as EstadoRepuesto } })
                      }
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
                <td><input value={nuevo.cod_sap} onChange={n("cod_sap")} placeholder="Código" aria-label="Código SAP nuevo" /></td>
                <td><input value={nuevo.descripcion} onChange={n("descripcion")} placeholder="Descripción" aria-label="Descripción nueva" /></td>
                <td className="num"><input type="number" min={0.01} step="any" value={nuevo.cantidad} onChange={n("cantidad")} aria-label="Cantidad nueva" /></td>
                <td><input value={nuevo.um} onChange={n("um")} aria-label="UM nueva" style={{ width: 60 }} /></td>
                <td><input value={nuevo.solicitud_sap} onChange={n("solicitud_sap")} aria-label="Solicitud nueva" /></td>
                <td><input type="date" value={nuevo.fecha_estimada} onChange={n("fecha_estimada")} aria-label="Fecha estimada nueva" /></td>
                <td>Por pedir</td>
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
                <td colSpan={8} className="nota">Sin repuestos.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
