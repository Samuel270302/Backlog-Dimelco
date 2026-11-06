import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../auth";
import { usePerfiles } from "../../lib/queries";
import { nombreUsuario } from "../../lib/backlog";
import { borrarFoto, subirFotos, type FotoConUrl } from "../../lib/fotos";
import { fFechaHora } from "../../lib/fmt";
import type { BacklogFila, BacklogRepuesto } from "../../lib/types";
import { useAvisos } from "../Avisos";
import DialogoConfirmar from "../DialogoConfirmar";

// Selector de archivos reutilizable: botón que abre el diálogo de Windows (varias fotos).
export function BotonFotos({
  texto,
  ocupado,
  onArchivos,
  etiqueta,
  plano,
}: {
  texto: string;
  ocupado?: boolean;
  onArchivos: (archivos: File[]) => void;
  etiqueta?: string;
  plano?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        multiple
        hidden
        aria-label={etiqueta ?? texto}
        onChange={(e) => {
          const archivos = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (archivos.length) onArchivos(archivos);
        }}
      />
      <button className={plano ? "boton-plano" : "boton-secundario"} disabled={ocupado} onClick={() => ref.current?.click()}>
        {ocupado ? "Subiendo…" : texto}
      </button>
    </>
  );
}

// Ctrl+V: las imágenes del portapapeles se agregan como fotos. No actúa si el cursor
// está en un campo de texto (ahí Ctrl+V pega texto).
export function usePegarImagenes(activo: boolean, onArchivos: (archivos: File[]) => void) {
  const ref = useRef(onArchivos);
  ref.current = onArchivos;
  useEffect(() => {
    if (!activo) return;
    const alPegar = (e: ClipboardEvent) => {
      const destino = e.target as HTMLElement | null;
      if (destino?.closest?.("input, textarea, [contenteditable='true']")) return;
      const imagenes = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
      if (!imagenes.length) return;
      e.preventDefault();
      const marca = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
      ref.current(
        imagenes.map((f, i) => new File([f], f.name && f.name !== "image.png" ? f.name : `pegada-${marca}-${i + 1}.png`, { type: f.type }))
      );
    };
    document.addEventListener("paste", alPegar);
    return () => document.removeEventListener("paste", alPegar);
  }, [activo]);
}

export function useSubirFotos(b: { id: string; unidad_id: string }) {
  const qc = useQueryClient();
  const { avisar } = useAvisos();
  const [subiendo, setSubiendo] = useState(false);
  async function subir(archivos: File[], repuestoId: string | null = null) {
    setSubiendo(true);
    const r = await subirFotos(b, archivos, repuestoId);
    setSubiendo(false);
    qc.invalidateQueries();
    if (r.subidas) avisar(`${r.subidas} foto(s) agregada(s)`);
    if (r.errores.length) avisar(`No se subieron: ${r.errores.join("; ")}`, "error");
  }
  return { subir, subiendo };
}

export default function Fotos({
  b,
  fotos,
  repuestos,
  editable,
}: {
  b: BacklogFila;
  fotos: FotoConUrl[];
  repuestos: BacklogRepuesto[];
  editable: boolean;
}) {
  const { esAdmin } = useAuth();
  const { data: perfiles } = usePerfiles();
  const { avisar } = useAvisos();
  const qc = useQueryClient();
  const { subir, subiendo } = useSubirFotos(b);
  const [destino, setDestino] = useState("");
  usePegarImagenes(editable && !subiendo, (a) => subir(a, destino || null));
  const [ampliada, setAmpliada] = useState<FotoConUrl | null>(null);
  const [aBorrar, setABorrar] = useState<FotoConUrl | null>(null);
  const ordenados = [...repuestos].sort((x, y) => x.item - y.item);
  const repuesto = (id: string | null) => ordenados.find((r) => r.id === id);
  const textoRepuesto = (r: BacklogRepuesto) => `Ítem ${r.item} · ${[r.numero_parte, r.cod_sap].filter(Boolean).join(" / ")}${r.descripcion ? ` · ${r.descripcion}` : ""}`;

  const grupos = [
    ...ordenados
      .map((r) => ({ titulo: textoRepuesto(r), fotos: fotos.filter((f) => f.repuesto_id === r.id) }))
      .filter((g) => g.fotos.length),
    { titulo: "Fotos generales", fotos: fotos.filter((f) => !f.repuesto_id || !repuesto(f.repuesto_id)) },
  ].filter((g) => g.fotos.length);

  const dialogoRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = dialogoRef.current;
    if (ampliada && d && !d.open) d.showModal();
  }, [ampliada]);

  return (
    <div className="bloque-ficha">
      <div className="barra-acciones">
        <h2 style={{ margin: 0 }}>
          Fotos <span className="nota">{fotos.length}</span>
        </h2>
        <div className="espacio" />
        {editable && (
          <>
            <select value={destino} onChange={(e) => setDestino(e.target.value)} aria-label="Las fotos son de">
              <option value="">Foto general del trabajo</option>
              {ordenados.map((r) => (
                <option key={r.id} value={r.id}>
                  {textoRepuesto(r)}
                </option>
              ))}
            </select>
            <BotonFotos texto="Agregar fotos" etiqueta="Archivos de fotos" ocupado={subiendo} onArchivos={(a) => subir(a, destino || null)} />
            <span className="nota solo-escritorio">o pegar con Ctrl+V</span>
          </>
        )}
      </div>
      {fotos.length === 0 && <p className="nota">Sin fotos. Las fotos de repuestos salen en la hoja 2 del formato impreso.</p>}
      {grupos.map((g) => (
        <div key={g.titulo} className="grupo-fotos">
          <div className="tk-seccion">{g.titulo}</div>
          <div className="rejilla-fotos">
            {g.fotos.map((f) => (
              <figure key={f.id} className="foto" aria-label={`Foto ${g.titulo}`}>
                <button className="foto-miniatura" onClick={() => setAmpliada(f)} title="Ver en grande">
                  {f.url ? <img src={f.url} alt={g.titulo} loading="lazy" /> : <span className="nota">Sin vista</span>}
                </button>
                <figcaption>
                  {fFechaHora(f.creado_en)} · {nombreUsuario(perfiles, f.creado_por)}
                  {esAdmin && editable && (
                    <button className="boton-plano boton-peligro-plano boton-chico" onClick={() => setABorrar(f)}>
                      Borrar
                    </button>
                  )}
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      ))}

      {ampliada && (
        <dialog
          ref={dialogoRef}
          className="dialogo-foto"
          onCancel={(e) => {
            e.preventDefault();
            setAmpliada(null);
          }}
          onClick={() => setAmpliada(null)}
        >
          {ampliada.url && <img src={ampliada.url} alt="Foto ampliada" />}
          <p className="nota">{repuesto(ampliada.repuesto_id) ? textoRepuesto(repuesto(ampliada.repuesto_id)!) : "Foto general"} · clic para cerrar</p>
        </dialog>
      )}
      {aBorrar && (
        <DialogoConfirmar
          titulo="Borrar foto"
          texto="La foto se borra del backlog y del almacenamiento. No se puede recuperar."
          confirmar="Borrar"
          onRespuesta={async (si) => {
            const f = aBorrar;
            setABorrar(null);
            if (!si || !f) return;
            try {
              await borrarFoto(f);
              avisar("Foto borrada");
            } catch (e) {
              avisar(`No se pudo borrar: ${(e as Error).message}`, "error");
            } finally {
              qc.invalidateQueries();
            }
          }}
        />
      )}
    </div>
  );
}
