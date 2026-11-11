import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAvisos } from "../Avisos";
import { fNum } from "../../lib/fmt";
import type { PreventivoMaterial } from "../../lib/types";

const NUEVO = { numero_parte: "", cod_sap: "", descripcion: "", cantidad: "1", um: "", observaciones: "" };

// Materiales utilizados en un preventivo. Los cambios se graban al salir de cada celda.
export default function TablaMateriales({
  preventivoId,
  filas,
  editable,
  sap,
  nota,
}: {
  preventivoId: string;
  filas: PreventivoMaterial[];
  editable: boolean;
  sap: boolean;
  nota?: string;
}) {
  const qc = useQueryClient();
  const { avisar } = useAvisos();
  const [nuevo, setNuevo] = useState(NUEVO);
  const ordenadas = [...filas].sort((a, b) => a.item - b.item);

  const accion = useMutation({
    mutationFn: async (
      op: { tipo: "agregar" } | { tipo: "cambiar"; id: string; cambios: Partial<PreventivoMaterial> } | { tipo: "quitar"; id: string }
    ) => {
      const t = supabase().from("preventivo_materiales");
      const { error } =
        op.tipo === "agregar"
          ? await t.insert({
              preventivo_id: preventivoId,
              numero_parte: nuevo.numero_parte.trim() || null,
              cod_sap: nuevo.cod_sap.trim() || null,
              descripcion: nuevo.descripcion.trim(),
              cantidad: Number(nuevo.cantidad),
              um: nuevo.um.trim() || null,
              observaciones: nuevo.observaciones.trim() || null,
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

  const valido = nuevo.descripcion.trim().length >= 2 && Number(nuevo.cantidad) > 0;
  const n = (k: keyof typeof NUEVO) => (e: React.ChangeEvent<HTMLInputElement>) => setNuevo((x) => ({ ...x, [k]: e.target.value }));

  type CampoTexto = "numero_parte" | "cod_sap" | "descripcion" | "um" | "observaciones";
  const texto = (f: PreventivoMaterial, campo: CampoTexto, etiqueta: string) =>
    editable ? (
      <input
        key={`${f.id}-${f[campo]}`}
        defaultValue={f[campo] ?? ""}
        aria-label={`${etiqueta} material ${f.item}`}
        onBlur={(e) => {
          const v = e.target.value.trim() || null;
          if (v === f[campo]) return;
          if (campo === "descripcion" && (v ?? "").length < 2) {
            avisar("Cada material necesita descripción", "error");
            e.target.value = f.descripcion;
            return;
          }
          accion.mutate({ tipo: "cambiar", id: f.id, cambios: { [campo]: v } });
        }}
      />
    ) : (
      f[campo]
    );

  return (
    <div className="bloque-ficha">
      <h2>
        Materiales utilizados <span className="nota">{filas.length === 0 ? "sin materiales" : `${filas.length} ítem(s)`}</span>
      </h2>
      {nota && <p className="nota">{nota}</p>}
      <div className="tabla-marco">
        <table className="tabla-edicion tabla-materiales">
          <thead>
            <tr>
              <th className="num">Ítem</th>
              <th>Número de parte</th>
              <th>{sap ? "Código SAP" : "Cód. interno"}</th>
              <th>Descripción</th>
              <th className="num">Cantidad</th>
              <th>Unidad</th>
              <th>Observaciones</th>
              {editable && <th />}
            </tr>
          </thead>
          <tbody>
            {ordenadas.map((f) => (
              <tr key={f.id}>
                <td className="num">{f.item}</td>
                <td>{texto(f, "numero_parte", "Número de parte")}</td>
                <td>{texto(f, "cod_sap", "Código")}</td>
                <td>{texto(f, "descripcion", "Descripción")}</td>
                <td className="num">
                  {editable ? (
                    <input
                      key={`${f.id}-${f.cantidad}`}
                      type="number"
                      min={0.01}
                      step="any"
                      defaultValue={f.cantidad}
                      aria-label={`Cantidad material ${f.item}`}
                      onBlur={(e) => {
                        const v = Number(e.target.value);
                        if (v === Number(f.cantidad)) return;
                        if (!(v > 0)) {
                          avisar("La cantidad debe ser mayor que 0", "error");
                          e.target.value = String(f.cantidad);
                          return;
                        }
                        accion.mutate({ tipo: "cambiar", id: f.id, cambios: { cantidad: v } });
                      }}
                    />
                  ) : (
                    fNum(f.cantidad, 2)
                  )}
                </td>
                <td>{texto(f, "um", "Unidad")}</td>
                <td>{texto(f, "observaciones", "Observaciones")}</td>
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
                <td><input value={nuevo.numero_parte} onChange={n("numero_parte")} placeholder="N° de parte" aria-label="Número de parte del material nuevo" /></td>
                <td><input value={nuevo.cod_sap} onChange={n("cod_sap")} placeholder="Código" aria-label="Código del material nuevo" /></td>
                <td><input value={nuevo.descripcion} onChange={n("descripcion")} placeholder="Filtro, aceite, grasa…" aria-label="Descripción del material nuevo" /></td>
                <td className="num"><input type="number" min={0.01} step="any" value={nuevo.cantidad} onChange={n("cantidad")} aria-label="Cantidad del material nuevo" /></td>
                <td><input value={nuevo.um} onChange={n("um")} placeholder="un, L, kg" aria-label="Unidad del material nuevo" /></td>
                <td><input value={nuevo.observaciones} onChange={n("observaciones")} aria-label="Observaciones del material nuevo" /></td>
                <td>
                  <button disabled={!valido || accion.isPending} onClick={() => accion.mutate({ tipo: "agregar" })}>
                    Agregar
                  </button>
                </td>
              </tr>
            )}
            {!editable && filas.length === 0 && (
              <tr>
                <td colSpan={7} className="nota">Sin materiales.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
