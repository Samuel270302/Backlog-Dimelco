import { useState } from "react";
import { guardarConexion } from "../lib/config";
import { reiniciarCliente } from "../lib/supabase";

export default function Setup({ alGuardar }: { alGuardar: () => void }) {
  const [url, setUrl] = useState("");
  const [anonKey, setAnonKey] = useState("");
  const [error, setError] = useState("");

  function guardar() {
    const u = url.trim().replace(/\/$/, "");
    if (!/^https:\/\/.+\.supabase\.co$/.test(u)) {
      setError("La URL debe tener la forma https://xxxx.supabase.co");
      return;
    }
    if (anonKey.trim().length < 20) {
      setError("Pegue la llave anon completa (Settings → API del proyecto)");
      return;
    }
    guardarConexion({ url: u, anonKey: anonKey.trim() });
    reiniciarCliente();
    alGuardar();
  }

  return (
    <div className="pantalla-centro">
      <div className="tarjeta">
        <h1>Conexión a la base de datos</h1>
        <p className="nota" style={{ marginBottom: 14 }}>
          Se configura una sola vez por PC. Los datos los entrega el administrador.
        </p>
        <label className="campo">
          <span>URL del proyecto Supabase</span>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://xxxx.supabase.co" />
        </label>
        <label className="campo">
          <span>Llave anon (pública)</span>
          <input value={anonKey} onChange={(e) => setAnonKey(e.target.value)} placeholder="eyJ…" />
        </label>
        {error && <div className="error-texto">{error}</div>}
        <button style={{ marginTop: 10, width: "100%" }} onClick={guardar}>
          Guardar y continuar
        </button>
      </div>
    </div>
  );
}
