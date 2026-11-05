import { useEffect, useRef, useState } from "react";

export const MIN_CONTRASENA = 8;

// Pide una contraseña nueva dos veces. Se usa para el cambio propio y para que el
// administrador restablezca la de otro usuario.
export default function DialogoContrasena({
  titulo,
  detalle,
  boton,
  ocupado = false,
  onAceptar,
  onCerrar,
}: {
  titulo: string;
  detalle?: string;
  boton: string;
  ocupado?: boolean;
  onAceptar: (contrasena: string) => void;
  onCerrar: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [nueva, setNueva] = useState("");
  const [repetida, setRepetida] = useState("");
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  const corta = nueva.length > 0 && nueva.length < MIN_CONTRASENA;
  const distinta = repetida.length > 0 && repetida !== nueva;
  const valida = nueva.length >= MIN_CONTRASENA && repetida === nueva;

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onCerrar();
      }}
    >
      <h1 style={{ fontSize: 16 }}>{titulo}</h1>
      {detalle && <p className="nota" style={{ marginTop: 0 }}>{detalle}</p>}
      <label className="campo">
        <span>Contraseña nueva</span>
        <input type="password" autoFocus autoComplete="new-password" value={nueva} onChange={(e) => setNueva(e.target.value)} />
      </label>
      <label className="campo">
        <span>Repita la contraseña</span>
        <input type="password" autoComplete="new-password" value={repetida} onChange={(e) => setRepetida(e.target.value)} />
      </label>
      <p className={`nota ${corta || distinta ? "control-error" : ""}`} style={{ marginTop: 0 }}>
        {distinta ? "Las contraseñas no coinciden." : `Mínimo ${MIN_CONTRASENA} caracteres.`}
      </p>
      <div className="barra-acciones" style={{ marginBottom: 0 }}>
        <div className="espacio" />
        <button className="boton-plano" onClick={onCerrar}>
          Cancelar
        </button>
        <button disabled={!valida || ocupado} onClick={() => onAceptar(nueva)}>
          {ocupado ? "Guardando…" : boton}
        </button>
      </div>
    </dialog>
  );
}
