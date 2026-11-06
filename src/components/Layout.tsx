import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { supabase } from "../lib/supabase";
import { useEstadoConexion } from "../lib/conexion";
import { cambiosPendientes, marcarPendientes } from "../lib/pendientes";
import DialogoConfirmar from "./DialogoConfirmar";
import DialogoContrasena from "./DialogoContrasena";
import AvisoActualizacion from "./AvisoActualizacion";
import { SelectorUnidad } from "../lib/unidad";
import { useAvisos } from "./Avisos";
import { useEsMovil } from "../lib/movil";
import {
  IconoAjustes,
  IconoCalendario,
  IconoCamion,
  IconoIndicadores,
  IconoKanban,
  IconoLlave,
  IconoMas,
  IconoPrograma,
  IconoUsuarios,
} from "./Iconos";
import logoApp from "../assets/logo-app.svg";

const enlaces = [
  { a: "/nuevo", texto: "Nuevo backlog", icono: <IconoMas />, captura: true },
  { a: "/flota", texto: "Por equipo", icono: <IconoCamion />, captura: false },
  { a: "/kanban", texto: "Kanban", icono: <IconoKanban />, captura: false },
  { a: "/calendario", texto: "Calendario", icono: <IconoCalendario />, captura: false },
  { a: "/indicadores", texto: "Indicadores", icono: <IconoIndicadores />, captura: false },
  { a: "/capacidad", texto: "Capacidad del taller", icono: <IconoAjustes />, captura: true },
];

// Nombre de la pantalla para el encabezado del celular.
function tituloDe(ruta: string): string {
  const todos = [...enlaces, ...enlacesAdmin];
  const exacto = todos.find((e) => e.a === ruta);
  if (exacto) return exacto.texto;
  if (ruta.startsWith("/backlog/")) return "Backlog";
  if (ruta.startsWith("/equipo/")) return "Equipo";
  return "Control de Backlog";
}

const NOMBRE_ROL = { admin: "Administrador", capturador: "Capturador", invitado: "Invitado (solo consulta)" };

const enlacesAdmin = [
  { a: "/equipos", texto: "Equipos", icono: <IconoPrograma /> },
  { a: "/catalogos", texto: "Familias y sistemas", icono: <IconoLlave /> },
  { a: "/plazos", texto: "Plazos por prioridad", icono: <IconoCalendario /> },
  { a: "/usuarios", texto: "Usuarios", icono: <IconoUsuarios /> },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const { perfil, esAdmin, puedeCapturar } = useAuth();
  const conexion = useEstadoConexion();
  const navegar = useNavigate();
  const [destino, setDestino] = useState<string | null>(null);
  const [cambiandoClave, setCambiandoClave] = useState(false);
  const [guardandoClave, setGuardandoClave] = useState(false);
  const { avisar } = useAvisos();
  const esMovil = useEsMovil();
  const { pathname } = useLocation();
  const [masAbierto, setMasAbierto] = useState(false);
  useEffect(() => setMasAbierto(false), [pathname]);
  // Barra inferior del celular: el capturador tiene Nuevo; admin e invitado, Calendario.
  const barra = [
    puedeCapturar && !esAdmin ? enlaces[0] : enlaces[3],
    enlaces[1],
    enlaces[2],
  ];

  async function cambiarClave(contrasena: string) {
    setGuardandoClave(true);
    const { error } = await supabase().auth.updateUser({ password: contrasena });
    setGuardandoClave(false);
    if (error) {
      avisar(
        error.message.includes("different from the old")
          ? "La contraseña nueva debe ser distinta de la actual"
          : `No se pudo cambiar la contraseña: ${error.message}`,
        "error"
      );
      return;
    }
    setCambiandoClave(false);
    avisar("Contraseña cambiada");
  }

  function alNavegar(e: React.MouseEvent, a: string) {
    if (cambiosPendientes() > 0) {
      e.preventDefault();
      setDestino(a);
    }
  }
  return (
    <div className="app">
      {cambiandoClave && (
        <DialogoContrasena
          titulo="Cambiar mi contraseña"
          detalle={perfil?.correo ?? undefined}
          boton="Cambiar"
          ocupado={guardandoClave}
          onAceptar={cambiarClave}
          onCerrar={() => setCambiandoClave(false)}
        />
      )}
      {esMovil && (
        <header className="cabecera-movil">
          <img className="logo-app" src={logoApp} alt="" />
          <span>{tituloDe(pathname)}</span>
          <span className={`punto-conexion ${conexion}`} title={conexion} />
        </header>
      )}
      {esMovil && masAbierto && <div className="velo-menu" onClick={() => setMasAbierto(false)} />}
      <aside className={`menu${esMovil ? " menu-movil" : ""}${masAbierto ? " abierto" : ""}`} aria-hidden={esMovil && !masAbierto}>
        <div className="logo">
          <img className="logo-app" src={logoApp} alt="" />
          <div>
            <span className="logo-titulo">Control de Backlog</span>
            <span className="logo-sub">Dimelco · mantenimiento</span>
          </div>
        </div>
        <SelectorUnidad />
        <nav>
          {enlaces.filter((e) => puedeCapturar || !e.captura).map((e) => (
            <NavLink key={e.a} to={e.a} onClick={(ev) => alNavegar(ev, e.a)} className={({ isActive }) => (isActive ? "activo" : "")}>
              {e.icono}
              {e.texto}
            </NavLink>
          ))}
          {esAdmin && (
            <>
              <div className="menu-seccion">Administración</div>
              {enlacesAdmin.map((e) => (
                <NavLink key={e.a} to={e.a} onClick={(ev) => alNavegar(ev, e.a)} className={({ isActive }) => (isActive ? "activo" : "")}>
                  {e.icono}
                  {e.texto}
                </NavLink>
              ))}
            </>
          )}
        </nav>
        <div className="menu-pie">
          <div className="usuario">
            <div>{perfil?.nombre ?? "…"}</div>
            <div className="usuario-rol">{perfil ? NOMBRE_ROL[perfil.rol] : ""}</div>
          </div>
          <button className="boton-plano" onClick={() => setCambiandoClave(true)}>
            Cambiar contraseña
          </button>
          <button className="boton-plano" onClick={() => supabase().auth.signOut()}>
            Cerrar sesión
          </button>
          <div className="pie-estado">
            <span className={`punto-conexion ${conexion}`} />
            {conexion === "en_linea" ? "En línea" : conexion === "reconectando" ? "Reconectando…" : "Sin conexión"}
            <span className="pie-version">v{__APP_VERSION__}</span>
          </div>
        </div>
      </aside>
      {esMovil && (
        <nav className="barra-inferior" aria-label="Navegación principal">
          {barra.map((e) => (
            <NavLink key={e.a} to={e.a} onClick={(ev) => alNavegar(ev, e.a)} className={({ isActive }) => (isActive ? "activo" : "")}>
              {e.icono}
              <span>{e.texto === "Nuevo backlog" ? "Nuevo" : e.texto}</span>
            </NavLink>
          ))}
          <button className={masAbierto ? "activo" : ""} onClick={() => setMasAbierto((x) => !x)} aria-expanded={masAbierto}>
            <IconoAjustes />
            <span>Más</span>
          </button>
        </nav>
      )}
      <main className="contenido">
        <AvisoActualizacion />
        {children}
      </main>
      {destino && (
        <DialogoConfirmar
          titulo="Hay cambios sin grabar"
          texto="Hay datos escritos que todavía no se grabaron. Si sales de la pantalla se pierden."
          confirmar="Salir sin grabar"
          cancelar="Seguir editando"
          onRespuesta={(si) => {
            const a = destino;
            setDestino(null);
            if (si) {
              marcarPendientes(0);
              navegar(a);
            }
          }}
        />
      )}
    </div>
  );
}
