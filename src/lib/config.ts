// Conexión a Supabase. En escritorio se captura una vez en la pantalla de
// configuración y queda guardada en este PC (localStorage del app). En la versión
// web viene fija desde VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY al compilar.
export interface ConexionConfig {
  url: string;
  anonKey: string;
}

const CLAVE = "backlog.conexion";

const urlFija = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const llaveFija = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const conexionFija = Boolean(urlFija && llaveFija);

export function leerConexion(): ConexionConfig | null {
  if (urlFija && llaveFija) return { url: urlFija, anonKey: llaveFija };
  try {
    const crudo = localStorage.getItem(CLAVE);
    if (!crudo) return null;
    const cfg = JSON.parse(crudo) as ConexionConfig;
    if (!cfg.url || !cfg.anonKey) return null;
    return cfg;
  } catch {
    return null;
  }
}

export function guardarConexion(cfg: ConexionConfig) {
  localStorage.setItem(CLAVE, JSON.stringify(cfg));
}

export function borrarConexion() {
  localStorage.removeItem(CLAVE);
}
