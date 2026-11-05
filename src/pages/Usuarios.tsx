import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { usePerfiles } from "../lib/queries";
import { useAuth } from "../auth";
import { useAvisos } from "../components/Avisos";
import { gestionarUsuario } from "../lib/usuarios";
import DialogoContrasena, { MIN_CONTRASENA } from "../components/DialogoContrasena";
import type { Perfil } from "../lib/types";
import { useUnidades } from "../lib/unidad";

const NUEVO = { nombre: "", correo: "", rol: "capturador", unidad_id: "", contrasena: "" };

export default function Usuarios() {
  const qc = useQueryClient();
  const { data: perfiles } = usePerfiles();
  const { perfil } = useAuth();
  const { avisar } = useAvisos();
  const { data: unidades } = useUnidades();
  const [nuevo, setNuevo] = useState(NUEVO);
  const [restableciendo, setRestableciendo] = useState<Perfil | null>(null);

  const crear = useMutation({
    mutationFn: () => gestionarUsuario({ accion: "crear", ...nuevo }),
    onSuccess: () => {
      avisar(`Usuario ${nuevo.nombre} creado. Entregue la contraseña por un medio privado.`);
      setNuevo(NUEVO);
      qc.invalidateQueries();
    },
    onError: (e: Error) => avisar(e.message, "error"),
  });

  const restablecer = useMutation({
    mutationFn: ({ user_id, contrasena }: { user_id: string; contrasena: string }) =>
      gestionarUsuario({ accion: "restablecer", user_id, contrasena }),
    onSuccess: () => {
      avisar(`Contraseña de ${restableciendo?.nombre} restablecida`);
      setRestableciendo(null);
    },
    onError: (e: Error) => avisar(e.message, "error"),
  });

  const actualizar = useMutation({
    mutationFn: async ({
      user_id,
      campo,
      valor,
    }: {
      user_id: string;
      campo: "rol" | "activo" | "nombre" | "unidad_id";
      valor: string | boolean | null;
    }) => {
      const { error } = await supabase()
        .from("perfiles")
        .update({ [campo]: valor })
        .eq("user_id", user_id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries(),
    onError: (e: Error) =>
      avisar(
        e.message.includes("perfiles_unidad_requerida")
          ? "Asigne una unidad antes de activar a un capturador o invitado"
          : e.message,
        "error"
      ),
  });

  const nuevoValido =
    nuevo.nombre.trim() !== "" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nuevo.correo.trim()) && nuevo.contrasena.length >= MIN_CONTRASENA &&
    (nuevo.rol === "admin" || nuevo.unidad_id !== "");

  return (
    <>
      {restableciendo && (
        <DialogoContrasena
          titulo={`Restablecer contraseña de ${restableciendo.nombre}`}
          detalle={`${restableciendo.correo ?? ""} · la contraseña actual deja de funcionar.`}
          boton="Restablecer"
          ocupado={restablecer.isPending}
          onAceptar={(contrasena) => restablecer.mutate({ user_id: restableciendo.user_id, contrasena })}
          onCerrar={() => setRestableciendo(null)}
        />
      )}
      <h1>Usuarios</h1>
      <p className="subtitulo">
        Un usuario inactivo no puede usar la app. El registro abierto está cerrado: las cuentas nuevas se crean aquí.
      </p>
      <div className="panel-formulario" style={{ maxWidth: 980 }}>
        <div className="fila-campos">
          <label className="campo" style={{ maxWidth: 200 }}>
            <span>Nuevo usuario: nombre</span>
            <input value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} placeholder="Planeador turno B" />
          </label>
          <label className="campo" style={{ maxWidth: 230 }}>
            <span>Correo (usuario de acceso)</span>
            <input value={nuevo.correo} onChange={(e) => setNuevo({ ...nuevo, correo: e.target.value })} placeholder="nombre@grupodimelco.com" />
          </label>
          <label className="campo" style={{ maxWidth: 190 }}>
            <span>Rol</span>
            <select value={nuevo.rol} onChange={(e) => setNuevo({ ...nuevo, rol: e.target.value })}>
              <option value="capturador">Capturador</option>
              <option value="invitado">Invitado (solo consulta)</option>
              <option value="admin">Administrador</option>
            </select>
          </label>
          <label className="campo" style={{ maxWidth: 170 }}>
            <span>Unidad</span>
            <select
              value={nuevo.rol === "admin" ? "" : nuevo.unidad_id}
              disabled={nuevo.rol === "admin"}
              onChange={(e) => setNuevo({ ...nuevo, unidad_id: e.target.value })}
            >
              <option value="">{nuevo.rol === "admin" ? "Todas" : "Seleccione"}</option>
              {(unidades ?? []).map((u) => (
                <option key={u.id} value={u.id}>{u.nombre}</option>
              ))}
            </select>
          </label>
          <label className="campo" style={{ maxWidth: 180 }}>
            <span>Contraseña inicial</span>
            <input
              type="password"
              autoComplete="new-password"
              value={nuevo.contrasena}
              onChange={(e) => setNuevo({ ...nuevo, contrasena: e.target.value })}
              placeholder={`Mínimo ${MIN_CONTRASENA} caracteres`}
            />
          </label>
          <div style={{ alignSelf: "flex-end" }}>
            <button disabled={!nuevoValido || crear.isPending} onClick={() => crear.mutate()}>
              {crear.isPending ? "Creando…" : "Crear usuario"}
            </button>
          </div>
        </div>
      </div>
      <div className="tabla-marco" style={{ maxWidth: 980 }}>
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Correo</th>
              <th>Rol</th>
              <th>Unidad</th>
              <th>Activo</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(perfiles ?? []).map((p) => (
              <tr key={p.user_id}>
                <td>
                  <input
                    style={{ width: 200 }}
                    defaultValue={p.nombre}
                    onBlur={(e) => {
                      if (e.target.value.trim() && e.target.value !== p.nombre)
                        actualizar.mutate({ user_id: p.user_id, campo: "nombre", valor: e.target.value.trim() });
                    }}
                  />
                </td>
                <td>{p.correo}</td>
                <td>
                  <select
                    value={p.rol}
                    disabled={p.user_id === perfil?.user_id}
                    onChange={(e) =>
                      actualizar.mutate({ user_id: p.user_id, campo: "rol", valor: e.target.value })
                    }
                  >
                    <option value="admin">Administrador</option>
                    <option value="capturador">Capturador</option>
                    <option value="invitado">Invitado (solo consulta)</option>
                  </select>
                </td>
                <td>
                  <select
                    value={p.unidad_id ?? ""}
                    disabled={p.rol === "admin"}
                    onChange={(e) => actualizar.mutate({ user_id: p.user_id, campo: "unidad_id", valor: e.target.value || null })}
                  >
                    <option value="">{p.rol === "admin" ? "Todas" : "Sin unidad"}</option>
                    {(unidades ?? []).map((u) => (
                      <option key={u.id} value={u.id}>{u.nombre}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <button
                    className="boton-plano"
                    disabled={p.user_id === perfil?.user_id}
                    onClick={() =>
                      actualizar.mutate({ user_id: p.user_id, campo: "activo", valor: !p.activo })
                    }
                  >
                    {p.activo ? "Sí · desactivar" : "No · activar"}
                  </button>
                </td>
                <td>
                  {p.user_id !== perfil?.user_id && (
                    <button className="boton-plano" onClick={() => setRestableciendo(p)}>
                      Restablecer contraseña
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
