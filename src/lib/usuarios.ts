import { supabase } from "./supabase";

// Llama a la función de borde admin-usuarios y devuelve el mensaje de error que
// ella arma (en español) en lugar del genérico del cliente.
export async function gestionarUsuario(cuerpo: Record<string, unknown>) {
  const { data, error } = await supabase().functions.invoke("admin-usuarios", { body: cuerpo });
  if (error) {
    let mensaje = error.message;
    try {
      const detalle = await (error as { context?: Response }).context?.json();
      if (detalle?.error) mensaje = detalle.error;
    } catch {
      // sin cuerpo legible: queda el mensaje del cliente
    }
    throw new Error(mensaje);
  }
  return data as { ok: true; user_id?: string };
}
