import { useEffect, useRef, useState } from "react";

// Electron no implementa window.prompt(); un texto corto (motivo, comentario) se pide
// con este diálogo propio. pedirMotivo() se resuelve con el texto, o con null si se cancela.
interface Opciones {
  etiqueta?: string;
  boton?: string;
  ejemplo?: string;
}
export function useDialogoMotivo() {
  const [pendiente, setPendiente] = useState<{
    titulo: string;
    detalle: string;
    opciones: Opciones;
    resolver: (v: string | null) => void;
  } | null>(null);

  function pedirMotivo(titulo: string, detalle = "", opciones: Opciones = {}): Promise<string | null> {
    return new Promise((resolver) => setPendiente({ titulo, detalle, opciones, resolver }));
  }

  const dialogo = pendiente ? (
    <DialogoMotivo
      titulo={pendiente.titulo}
      detalle={pendiente.detalle}
      {...pendiente.opciones}
      onCerrar={(v) => {
        pendiente.resolver(v);
        setPendiente(null);
      }}
    />
  ) : null;

  return { pedirMotivo, dialogo };
}

function DialogoMotivo({
  titulo,
  detalle,
  etiqueta = "Motivo",
  boton = "Aceptar",
  ejemplo = "",
  onCerrar,
}: Opciones & {
  titulo: string;
  detalle: string;
  onCerrar: (motivo: string | null) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [motivo, setMotivo] = useState("");

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  const valido = motivo.trim().length >= 3;

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onCerrar(null);
      }}
    >
      <h1 style={{ fontSize: 16 }}>{titulo}</h1>
      {detalle && <p className="nota" style={{ marginTop: 0 }}>{detalle}</p>}
      <label className="campo">
        <span>{etiqueta}</span>
        <textarea
          rows={3}
          autoFocus
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder={ejemplo}
        />
      </label>
      <div className="barra-acciones" style={{ marginBottom: 0 }}>
        <div className="espacio" />
        <button className="boton-plano" onClick={() => onCerrar(null)}>
          Cancelar
        </button>
        <button disabled={!valido} onClick={() => onCerrar(motivo.trim())}>
          {boton}
        </button>
      </div>
    </dialog>
  );
}
