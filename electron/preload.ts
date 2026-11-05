import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("appInfo", {
  plataforma: process.platform,
  guardarPdf: (html: string, nombre: string, vertical = false): Promise<string | null> =>
    ipcRenderer.invoke("guardar-pdf", html, nombre, vertical),
  guardarArchivo: (datos: Uint8Array, nombre: string): Promise<string | null> =>
    ipcRenderer.invoke("guardar-archivo", datos, nombre),
  // Actualización automática: versión ya descargada (o null) y reinicio para instalarla.
  versionLista: (): Promise<string | null> => ipcRenderer.invoke("version-lista"),
  alActualizacionLista: (fn: (version: string) => void) => {
    const oyente = (_e: unknown, version: string) => fn(version);
    ipcRenderer.on("actualizacion-lista", oyente);
    return () => ipcRenderer.removeListener("actualizacion-lista", oyente);
  },
  instalarActualizacion: (): Promise<void> => ipcRenderer.invoke("instalar-actualizacion"),
});
