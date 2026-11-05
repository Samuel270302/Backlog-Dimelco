import { useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { leerConexion } from "./lib/config";
import { supabase } from "./lib/supabase";
import { AuthProvider, useAuth } from "./auth";
import { useTiempoReal } from "./lib/queries";
import { UnidadProvider } from "./lib/unidad";
import Layout from "./components/Layout";
import { AvisosProvider } from "./components/Avisos";
import Setup from "./pages/Setup";
import Login from "./pages/Login";
import Usuarios from "./pages/Usuarios";
import EnConstruccion from "./pages/EnConstruccion";
import NuevoBacklog from "./pages/NuevoBacklog";
import FichaBacklog from "./pages/FichaBacklog";

function Interior() {
  const { session, perfil, cargando, esAdmin, puedeCapturar } = useAuth();
  if (cargando) return <div className="pantalla-centro">Cargando…</div>;
  if (!session) return <Login />;
  if (!perfil?.activo) return <AccesoPendiente correo={session.user.email ?? ""} />;
  return (
    <UnidadProvider>
      <ConRealtime esAdmin={esAdmin} puedeCapturar={puedeCapturar} />
    </UnidadProvider>
  );
}

function AccesoPendiente({ correo }: { correo: string }) {
  return (
    <div className="pantalla-centro">
      <div className="tarjeta">
        <h1>Acceso pendiente de activación</h1>
        <p className="nota" style={{ marginBottom: 14 }}>
          La cuenta {correo} existe, pero un administrador todavía no la activa ni le asigna rol.
          Pídele al administrador que la active en la pantalla Usuarios.
        </p>
        <button className="boton-plano" style={{ width: "100%" }} onClick={() => supabase().auth.signOut()}>
          Cerrar sesión
        </button>
      </div>
    </div>
  );
}

function ConRealtime({ esAdmin, puedeCapturar }: { esAdmin: boolean; puedeCapturar: boolean }) {
  useTiempoReal();
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/backlog" replace />} />
        {puedeCapturar && <Route path="/nuevo" element={<NuevoBacklog />} />}
        <Route path="/backlog" element={<EnConstruccion titulo="Tablero de backlog" fase={4} />} />
        <Route path="/backlog/:id" element={<FichaBacklog />} />
        <Route path="/kanban" element={<EnConstruccion titulo="Kanban" fase={4} />} />
        <Route path="/programa" element={<EnConstruccion titulo="Programación semanal" fase={5} />} />
        <Route path="/equipo/:id" element={<EnConstruccion titulo="Ficha de equipo" fase={4} />} />
        <Route path="/indicadores" element={<EnConstruccion titulo="Indicadores" fase={6} />} />
        {esAdmin && <Route path="/equipos" element={<EnConstruccion titulo="Equipos" fase={2} />} />}
        {esAdmin && <Route path="/catalogos" element={<EnConstruccion titulo="Sistemas y especialidades" fase={2} />} />}
        {esAdmin && <Route path="/capacidad" element={<EnConstruccion titulo="Capacidad del taller" fase={5} />} />}
        {esAdmin && <Route path="/usuarios" element={<Usuarios />} />}
        <Route path="*" element={<Navigate to="/backlog" replace />} />
      </Routes>
    </Layout>
  );
}

export default function App() {
  const [configurado, setConfigurado] = useState(() => leerConexion() !== null);
  if (!configurado) return <Setup alGuardar={() => setConfigurado(true)} />;
  return (
    <AuthProvider>
      <AvisosProvider>
        <Interior />
      </AvisosProvider>
    </AuthProvider>
  );
}
