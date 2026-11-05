import { useState } from "react";
import { supabase } from "../lib/supabase";
import { borrarConexion, conexionFija } from "../lib/config";
import logo from "../assets/logo-dimelco.png";
import logoApp from "../assets/logo-app.svg";

export default function Login() {
  const [correo, setCorreo] = useState("");
  const [clave, setClave] = useState("");
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setCargando(true);
    setError("");
    const { error } = await supabase().auth.signInWithPassword({
      email: correo.trim(),
      password: clave,
    });
    setCargando(false);
    if (error) setError("Correo o contraseña incorrectos");
  }

  return (
    <div className="pantalla-centro">
      <form className="tarjeta" onSubmit={entrar}>
        <div className="login-marca">
          <img src={logoApp} alt="" />
          <div>
            <div className="login-titulo">Control de Backlog</div>
            <div className="login-sub">Dimelco · mantenimiento</div>
          </div>
        </div>
        <label className="campo">
          <span>Correo</span>
          <input type="email" value={correo} onChange={(e) => setCorreo(e.target.value)} autoFocus />
        </label>
        <label className="campo">
          <span>Contraseña</span>
          <input type="password" value={clave} onChange={(e) => setClave(e.target.value)} />
        </label>
        {error && <div className="error-texto">{error}</div>}
        <button style={{ marginTop: 10, width: "100%" }} disabled={cargando}>
          {cargando ? "Entrando…" : "Entrar"}
        </button>
        {!conexionFija && (
          <button
            type="button"
            className="boton-plano"
            style={{ marginTop: 10, width: "100%" }}
            onClick={() => {
              borrarConexion();
              location.reload();
            }}
          >
            Cambiar conexión a la base
          </button>
        )}
        <img className="logo-login" src={logo} alt="Dimelco" />
      </form>
    </div>
  );
}
