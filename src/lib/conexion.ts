import { useSyncExternalStore } from "react";

// Estado de la conexión mostrado al pie del menú. Combina la red del equipo
// (navigator.onLine) con el canal de tiempo real de Supabase.
export type EstadoConexion = "en_linea" | "reconectando" | "sin_conexion";

let canal: "ok" | "caido" | "iniciando" = "iniciando";
const oyentes = new Set<() => void>();
const avisar = () => oyentes.forEach((f) => f());

window.addEventListener("online", avisar);
window.addEventListener("offline", avisar);

export function reportarCanal(estado: string) {
  canal = estado === "SUBSCRIBED" ? "ok" : estado === "CLOSED" ? "iniciando" : "caido";
  avisar();
}

function leer(): EstadoConexion {
  if (!navigator.onLine) return "sin_conexion";
  return canal === "ok" ? "en_linea" : "reconectando";
}

export function useEstadoConexion(): EstadoConexion {
  return useSyncExternalStore(
    (f) => {
      oyentes.add(f);
      return () => oyentes.delete(f);
    },
    leer
  );
}
