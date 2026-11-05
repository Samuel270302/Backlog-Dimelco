import { createContext, useContext, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import type { Perfil } from "./lib/types";

interface Auth {
  session: Session | null;
  perfil: Perfil | null;
  cargando: boolean;
  esAdmin: boolean;
  puedeCapturar: boolean;
}

const Ctx = createContext<Auth>({
  session: null,
  perfil: null,
  cargando: true,
  esAdmin: false,
  puedeCapturar: false,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  // Usuario cuyo perfil ya se consultó; mientras no coincida con la sesión, el rol
  // es desconocido y las rutas por rol no deben decidirse todavía.
  const [perfilDe, setPerfilDe] = useState<string | null>(null);
  const [cargandoSesion, setCargandoSesion] = useState(true);

  useEffect(() => {
    const sb = supabase();
    sb.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setCargandoSesion(false);
    });
    const { data: sub } = sb.auth.onAuthStateChange((_ev, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id ?? null;
  useEffect(() => {
    if (!userId) {
      setPerfil(null);
      setPerfilDe(null);
      return;
    }
    supabase()
      .from("perfiles")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data }) => {
        setPerfil((data as Perfil) ?? null);
        setPerfilDe(userId);
      });
  }, [userId]);

  const cargando = cargandoSesion || (userId !== null && perfilDe !== userId);

  return (
    <Ctx.Provider
      value={{
        session,
        perfil,
        cargando,
        esAdmin: perfil?.rol === "admin",
        puedeCapturar: perfil?.rol === "admin" || perfil?.rol === "capturador",
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
