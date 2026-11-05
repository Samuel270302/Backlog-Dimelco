import { useEffect, useState } from "react";

interface Escritorio {
  versionLista?: () => Promise<string | null>;
  alActualizacionLista?: (fn: (version: string) => void) => () => void;
  instalarActualizacion?: () => Promise<void>;
}
const escritorio = () => (window as unknown as { appInfo?: Escritorio }).appInfo;

// Franja que aparece cuando la versión nueva ya se descargó. Si el usuario no
// reinicia, se instala sola al cerrar la app.
export default function AvisoActualizacion() {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    const e = escritorio();
    e?.versionLista?.().then((v) => v && setVersion(v));
    return e?.alActualizacionLista?.((v) => setVersion(v));
  }, []);
  if (!version) return null;
  return (
    <div className="aviso-actualizacion" role="status">
      <span>
        La versión {version} está lista. Se instala al cerrar la app, o ahora si reinicia.
      </span>
      <button onClick={() => escritorio()?.instalarActualizacion?.()}>Reiniciar y actualizar</button>
    </div>
  );
}
