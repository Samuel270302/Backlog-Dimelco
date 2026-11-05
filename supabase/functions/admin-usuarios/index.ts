// F7 · Altas de usuarios y restablecimiento de contraseñas desde la app.
// Solo la llama un administrador activo: la función valida el token de quien llama
// y su perfil antes de usar la llave de servicio, que nunca sale del servidor.
import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const ROLES = ["admin", "capturador", "invitado"];
const MIN_CONTRASENA = 8;

function respuesta(cuerpo: unknown, estado = 200) {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
const falla = (mensaje: string, estado = 400) => respuesta({ error: mensaje }, estado);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return falla("Método no permitido", 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const servicio = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: quien, error: errQuien } = await servicio.auth.getUser(token);
  if (errQuien || !quien.user) return falla("Sesión no válida", 401);
  const { data: perfil } = await servicio
    .from("perfiles")
    .select("rol, activo")
    .eq("user_id", quien.user.id)
    .maybeSingle();
  if (!perfil || perfil.rol !== "admin" || !perfil.activo)
    return falla("Solo un administrador activo puede gestionar usuarios", 403);

  let datos: Record<string, unknown>;
  try {
    datos = await req.json();
  } catch {
    return falla("Cuerpo inválido");
  }
  const contrasena = String(datos.contrasena ?? "");
  if (contrasena.length < MIN_CONTRASENA)
    return falla(`La contraseña debe tener al menos ${MIN_CONTRASENA} caracteres`);

  if (datos.accion === "crear") {
    const correo = String(datos.correo ?? "").trim().toLowerCase();
    const nombre = String(datos.nombre ?? "").trim();
    const rol = String(datos.rol ?? "");
    const unidad = rol === "admin" ? null : String(datos.unidad_id ?? "") || null;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) return falla("Correo inválido");
    if (!nombre) return falla("El nombre es obligatorio");
    if (!ROLES.includes(rol)) return falla("Rol inválido");
    if (rol !== "admin" && !unidad) return falla("Elija la unidad del usuario");

    const { data: creado, error } = await servicio.auth.admin.createUser({
      email: correo,
      password: contrasena,
      email_confirm: true,
      user_metadata: { nombre },
    });
    if (error || !creado.user)
      return falla(
        error?.message?.includes("already been registered")
          ? "Ya existe un usuario con ese correo"
          : `No se pudo crear: ${error?.message ?? "sin detalle"}`
      );
    // crear_perfil deja el perfil como capturador inactivo; aquí se fija lo pedido.
    const { error: errPerfil } = await servicio
      .from("perfiles")
      .update({ nombre, rol, activo: true, unidad_id: unidad })
      .eq("user_id", creado.user.id);
    if (errPerfil) return falla(`Usuario creado, pero el perfil no se actualizó: ${errPerfil.message}`, 500);
    return respuesta({ ok: true, user_id: creado.user.id });
  }

  if (datos.accion === "restablecer") {
    const id = String(datos.user_id ?? "");
    if (!id) return falla("Falta el usuario");
    const { error } = await servicio.auth.admin.updateUserById(id, { password: contrasena });
    if (error) return falla(`No se pudo restablecer: ${error.message}`);
    return respuesta({ ok: true });
  }

  return falla("Acción desconocida");
});
