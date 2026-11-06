import { useSyncExternalStore } from "react";

// Pantalla de celular: menos de 768 px de ancho. Las vistas cambian de forma (barra
// inferior, calendario por día); el escritorio no cambia.
const CONSULTA = "(max-width: 767px)";

export function useEsMovil(): boolean {
  return useSyncExternalStore(
    (avisar) => {
      const m = window.matchMedia(CONSULTA);
      m.addEventListener("change", avisar);
      return () => m.removeEventListener("change", avisar);
    },
    () => window.matchMedia(CONSULTA).matches
  );
}
