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

const NUEVO = { nombre: "", correo: "", rol: "capturador", unidades: [] as string[], contrasena: "" };

// Casillas de unidades: capturador e invitado ven solo las marcadas; el admin, todas.
function CasillasUnidades({
  unidades,
  marcadas,
  onCambio,
  compacto,
  deshabilitado,
  quien,
}: {
  unidades: { id: string; nombre: string; sigla: string }[];
  marcadas: string[];
  onCambio: (lista: string[]) => void;
  compacto?: boolean;
  deshabilitado?: boolean;
  quien: string;
}) {
  return (
    <div className={`casillas-unidades${compacto ? " compacto" : ""}`} role="group" aria-label={`Unidades de ${quien}`}>
      {unidades.map((u) => {
        const si = marcadas.includes(u.id);
        return (
          <label key={u.id} className="campo-check" title={u.nombre}>
            <input
              type="checkbox"
              checked={si}
              disabled={deshabilitado}
              aria-label={`${u.nombre} ${quien}`}
              onChange={() => onCambio(si ? marcadas.filter((x) => x !== u.id) : unidades.filter((x) => x.id === u.id || marcadas.includes(x.id)).map((x) => x.id))}
            />
            {compacto ? u.sigla : u.nombre}
          </label>
        );
      })}
    </div>
  );
}

export default function Usuarios() {
  const qc = useQueryClient();
  const { data: perfiles } = usePerfiles();
  const { perfil } = useAuth();
  const { avisar } = useAvisos();
  const { data: unidades } = useUnidades();
  const [nuevo, setNuevo] = useState(NUEVO);
  const [restableciendo, setRestableciendo] = useState<Perfil | null>(null);

  const crear = useMutation({
    // La función crea el usuario con la primera unidad; las demás se graban después.
    mutationFn: async () => {
      const r = await gestionarUsuario({
        accion: "crear",
        nombre: nuevo.nombre,
        correo: nuevo.correo,
        rol: nuevo.rol,
        contrasena: nuevo.contrasena,
        unidad_id: nuevo.rol === "admin" ? null : nuevo.unidades[0],
      });
      if (nuevo.rol !== "admin" && nuevo.unidades.length > 1 && r.user_id) {
        const { error } = await supabase().from("perfiles").update({ unidades: nuevo.unidades }).eq("user_id", r.user_id);
        if (error) throw new Error(`Usuario creado, pero no se grabaron todas sus unidades: ${error.message}`);
      }
    },
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
      campo: "rol" | "activo" | "nombre" | "unidades";
      valor: string | boolean | string[] | null;
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
          ? "Un capturador o invitado activo necesita al menos una unidad"
          : e.message,
        "error"
      ),
  });

  const nuevoValido =
    nuevo.nombre.trim() !== "" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nuevo.correo.trim()) && nuevo.contrasena.length >= MIN_CONTRASENA &&
    (nuevo.rol === "admin" || nuevo.unidades.length > 0);
  const listaUnidades = (unidades ?? []).filter((u) => u.activo);

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
          <div className="campo" style={{ maxWidth: 300 }}>
            <span className="etiqueta-campo">Unidades que puede ver</span>
            {nuevo.rol === "admin" ? (
              <span className="nota" style={{ paddingTop: 10 }}>Todas (administrador)</span>
            ) : (
              <CasillasUnidades
                unidades={listaUnidades}
                marcadas={nuevo.unidades}
                onCambio={(l) => setNuevo({ ...nuevo, unidades: l })}
                quien="usuario nuevo"
              />
            )}
          </div>
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
              <th>Unidades</th>
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
                  {p.rol === "admin" ? (
                    <span className="nota">Todas</span>
                  ) : (
                    <CasillasUnidades
                      compacto
                      unidades={listaUnidades}
                      marcadas={p.unidades?.length ? p.unidades : p.unidad_id ? [p.unidad_id] : []}
                      deshabilitado={actualizar.isPending}
                      quien={p.nombre}
                      onCambio={(l) => {
                        if (l.length === 0 && p.activo) {
                          avisar("Un capturador o invitado activo necesita al menos una unidad", "error");
                          return;
                        }
                        actualizar.mutate({ user_id: p.user_id, campo: "unidades", valor: l });
                      }}
                    />
                  )}
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
