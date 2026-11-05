import { useEffect, useRef } from "react";

export default function DialogoConfirmar({
  titulo,
  texto,
  confirmar,
  onRespuesta,
}: {
  titulo: string;
  texto: string;
  confirmar: string;
  onRespuesta: (si: boolean) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onRespuesta(false);
      }}
    >
      <h1 style={{ fontSize: 16 }}>{titulo}</h1>
      <p className="nota" style={{ marginTop: 0 }}>{texto}</p>
      <div className="barra-acciones" style={{ marginBottom: 0 }}>
        <div className="espacio" />
        <button className="boton-plano" autoFocus onClick={() => onRespuesta(false)}>
          Seguir capturando
        </button>
        <button onClick={() => onRespuesta(true)}>{confirmar}</button>
      </div>
    </dialog>
  );
}
