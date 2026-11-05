import { useEffect, useRef, useState } from "react";

// Electron no implementa window.prompt(); el motivo de una anulación se pide con
// este diálogo propio. pedirMotivo() se resuelve con el texto, o con null si se cancela.
export function useDialogoMotivo() {
  const [pendiente, setPendiente] = useState<{
    titulo: string;
    detalle: string;
    resolver: (v: string | null) => void;
  } | null>(null);

  function pedirMotivo(titulo: string, detalle = ""): Promise<string | null> {
    return new Promise((resolver) => setPendiente({ titulo, detalle, resolver }));
  }

  const dialogo = pendiente ? (
    <DialogoMotivo
      titulo={pendiente.titulo}
      detalle={pendiente.detalle}
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
  onCerrar,
}: {
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
        <span>Motivo de la anulación</span>
        <textarea
          rows={3}
          autoFocus
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="Ej.: lectura cargada como acumulado en vez de contador"
        />
      </label>
      <div className="barra-acciones" style={{ marginBottom: 0 }}>
        <div className="espacio" />
        <button className="boton-plano" onClick={() => onCerrar(null)}>
          Cancelar
        </button>
        <button disabled={!valido} onClick={() => onCerrar(motivo.trim())}>
          Anular registro
        </button>
      </div>
    </dialog>
  );
}
