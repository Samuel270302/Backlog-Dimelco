import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { leerConexion } from "./config";

let cliente: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!cliente) {
    const cfg = leerConexion();
    if (!cfg) throw new Error("Sin configuración de conexión");
    cliente = createClient(cfg.url, cfg.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
  }
  return cliente;
}

// Cerrar sesión solo en este navegador o PC ("local"). Por defecto Supabase cierra la
// sesión del usuario en todos los dispositivos; con un usuario compartido (por ejemplo
// un invitado repartido a varias personas) eso sacaría a todos.
export function cerrarSesion() {
  return supabase().auth.signOut({ scope: "local" });
}

export function reiniciarCliente() {
  cliente = null;
}
