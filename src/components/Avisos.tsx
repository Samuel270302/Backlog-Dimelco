import { createContext, useCallback, useContext, useState } from "react";

type Tipo = "ok" | "error" | "info";
interface Aviso {
  id: number;
  texto: string;
  tipo: Tipo;
}

const Ctx = createContext<{ avisar: (texto: string, tipo?: Tipo) => void }>({ avisar: () => {} });

let siguiente = 1;

export function AvisosProvider({ children }: { children: React.ReactNode }) {
  const [avisos, setAvisos] = useState<Aviso[]>([]);

  const cerrar = useCallback((id: number) => setAvisos((a) => a.filter((x) => x.id !== id)), []);

  const avisar = useCallback(
    (texto: string, tipo: Tipo = "ok") => {
      const id = siguiente++;
      setAvisos((a) => [...a.slice(-3), { id, texto, tipo }]);
      // Los errores quedan más tiempo en pantalla para alcanzar a leerlos.
      setTimeout(() => cerrar(id), tipo === "error" ? 9000 : 4500);
    },
    [cerrar]
  );

  return (
    <Ctx.Provider value={{ avisar }}>
      {children}
      <div className="avisos" role="status" aria-live="polite">
        {avisos.map((a) => (
          <div key={a.id} className={`aviso aviso-${a.tipo}`}>
            <span className="aviso-icono">{a.tipo === "ok" ? "✓" : a.tipo === "error" ? "!" : "i"}</span>
            <span className="aviso-texto">{a.texto}</span>
            <button className="aviso-cerrar" onClick={() => cerrar(a.id)} aria-label="Cerrar aviso">
              ×
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useAvisos = () => useContext(Ctx);
