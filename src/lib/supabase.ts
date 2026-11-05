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

export function reiniciarCliente() {
  cliente = null;
}
