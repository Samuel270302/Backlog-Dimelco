import { createContext, useContext, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";
import { useAuth } from "../auth";
import type { Unidad } from "./types";

// Unidad que se está mirando. El admin elige una o "Todas" (null) en el menú; el resto
// de los usuarios queda fijo en la unidad de su perfil, que además es lo único que la
// base le entrega.
const CLAVE = "backlog.unidad";

interface ContextoUnidad {
  unidadId: string | null;
  setUnidadId: (id: string | null) => void;
  puedeElegir: boolean;
  // Unidades que el usuario puede ver; null = todas (admin).
  permitidas: string[] | null;
}

const Contexto = createContext<ContextoUnidad>({ unidadId: null, setUnidadId: () => {}, puedeElegir: false, permitidas: null });

function leer(): string | null {
  try {
    return localStorage.getItem(CLAVE) || null;
  } catch {
    return null;
  }
}

export function UnidadProvider({ children }: { children: React.ReactNode }) {
  const { perfil, esAdmin } = useAuth();
  const [elegida, setElegida] = useState<string | null>(leer);
  // Capturador o invitado: sus unidades (perfiles.unidades). Con una sola queda fija;
  // con varias elige una o "Todas mis unidades" (null, la base ya limita lo que recibe).
  const propias = esAdmin ? null : perfil?.unidades?.length ? perfil.unidades : perfil?.unidad_id ? [perfil.unidad_id] : [];
  const puedeElegir = esAdmin || (propias?.length ?? 0) > 1;
  const unidadId = esAdmin
    ? elegida
    : propias && propias.length === 1
      ? propias[0]
      : elegida && propias?.includes(elegida)
        ? elegida
        : null;

  useEffect(() => {
    if (!puedeElegir) return;
    try {
      if (elegida) localStorage.setItem(CLAVE, elegida);
      else localStorage.removeItem(CLAVE);
    } catch {
      // sin almacenamiento: la elección dura la sesión
    }
  }, [elegida, puedeElegir]);

  return (
    <Contexto.Provider value={{ unidadId, setUnidadId: setElegida, puedeElegir, permitidas: propias }}>
      {children}
    </Contexto.Provider>
  );
}

export const useUnidad = () => useContext(Contexto);

export const useUnidades = () =>
  useQuery({
    queryKey: ["unidades"],
    queryFn: async () => {
      const { data, error } = await supabase().from("unidades").select("*").order("orden");
      if (error) throw error;
      return data as Unidad[];
    },
  });

// SAP solo lo usa HEMCO (unidades.usa_sap). Fuera de HEMCO no se muestran Aviso SAP,
// códigos SAP ni SolPed, y la OT se llama "N° OT".
export function useUsaSap(): (unidadId: string | null | undefined) => boolean {
  const { data } = useUnidades();
  return (id) => !!id && !!data?.find((u) => u.id === id)?.usa_sap;
}
export const etiquetaOt = (usaSap: boolean) => (usaSap ? "OT SAP" : "N° OT");

// Nombre de la unidad en vista, para títulos y nombres de archivo.
export function useNombreUnidad(): string | null {
  const { unidadId } = useUnidad();
  const { data } = useUnidades();
  return unidadId ? (data?.find((u) => u.id === unidadId)?.nombre ?? null) : null;
}

export function SelectorUnidad() {
  const { unidadId, setUnidadId, puedeElegir, permitidas } = useUnidad();
  const { data: unidades } = useUnidades();
  const nombre = useNombreUnidad();
  if (!puedeElegir) return nombre ? <div className="unidad-fija">Unidad {nombre}</div> : null;
  return (
    <label className="selector-unidad">
      <span>Unidad</span>
      <select value={unidadId ?? ""} onChange={(e) => setUnidadId(e.target.value || null)}>
        <option value="">{permitidas ? "Todas mis unidades" : "Todas las unidades"}</option>
        {(unidades ?? []).filter((u) => u.activo && (!permitidas || permitidas.includes(u.id))).map((u) => (
          <option key={u.id} value={u.id}>
            {u.nombre}
          </option>
        ))}
      </select>
    </label>
  );
}
