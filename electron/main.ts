import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { autoUpdater } from "electron-updater";

// Carpeta de datos propia: la conexión, la sesión y la unidad elegida no se cruzan
// con la app de preventivos aunque las dos estén instaladas en el mismo PC.
app.setPath("userData", path.join(app.getPath("appData"), "Backlog HEMCO"));

// El renderer no puede abrir ventanas nuevas (ver setWindowOpenHandler); los
// reportes se convierten a PDF aquí, en una ventana oculta sin JavaScript.
ipcMain.handle("guardar-pdf", async (evento, html: string, nombre: string) => {
  const padre = BrowserWindow.fromWebContents(evento.sender) ?? undefined;
  const opciones = {
    title: "Guardar reporte",
    defaultPath: path.join(app.getPath("documents"), nombre),
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  };
  const { canceled, filePath } = padre
    ? await dialog.showSaveDialog(padre, opciones)
    : await dialog.showSaveDialog(opciones);
  if (canceled || !filePath) return null;
  const oculta = new BrowserWindow({ show: false, webPreferences: { javascript: false } });
  try {
    await oculta.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
    const pdf = await oculta.webContents.printToPDF({
      landscape: true,
      pageSize: "A4",
      printBackground: true,
      margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 },
    });
    await writeFile(filePath, pdf);
  } finally {
    oculta.destroy();
  }
  await shell.openPath(filePath);
  return filePath;
});

// Electron ignora el atributo download de los enlaces (guarda "download" sin
// extensión), así que los archivos exportados se guardan desde aquí.
ipcMain.handle("guardar-archivo", async (evento, datos: Uint8Array, nombre: string) => {
  const padre = BrowserWindow.fromWebContents(evento.sender) ?? undefined;
  const extension = path.extname(nombre).slice(1).toLowerCase();
  const opciones = {
    title: "Guardar archivo",
    defaultPath: path.join(app.getPath("documents"), nombre),
    filters: extension === "xlsx" ? [{ name: "Libro de Excel", extensions: ["xlsx"] }] : [],
  };
  const { canceled, filePath } = padre
    ? await dialog.showSaveDialog(padre, opciones)
    : await dialog.showSaveDialog(opciones);
  if (canceled || !filePath) return null;
  await writeFile(filePath, Buffer.from(datos));
  return filePath;
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: "#111518",
    title: "Control de Backlog - Dimelco",
    icon: path.join(__dirname, "../dist/icono.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    win.loadURL(devUrl);
  } else {
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }
  // Un formulario con cambios sin grabar bloquea el cierre (beforeunload);
  // aquí se le pregunta al usuario en vez de ignorar el cierre.
  win.webContents.on("will-prevent-unload", (evento) => {
    const respuesta = dialog.showMessageBoxSync(win, {
      type: "question",
      buttons: ["Salir sin grabar", "Seguir editando"],
      defaultId: 1,
      cancelId: 1,
      title: "Control de Backlog - Dimelco",
      message: "Hay cambios sin grabar",
      detail: "Si cierras la app, lo escrito y no grabado se pierde.",
    });
    if (respuesta === 0) evento.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

// F9 · Actualización automática desde los releases de GitHub (latest.yml).
// Descarga en segundo plano; la app avisa y el usuario decide cuándo reiniciar.
// Sin el instalador empaquetado (desarrollo, pruebas) no se busca nada.
const CADA_4_HORAS = 4 * 60 * 60 * 1000;
let versionLista: string | null = null;

function avisarActualizacion() {
  if (!versionLista) return;
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send("actualizacion-lista", versionLista);
}

function iniciarActualizaciones() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("update-downloaded", (info) => {
    versionLista = info.version;
    avisarActualizacion();
  });
  autoUpdater.on("error", (e) => console.error("Actualización:", e?.message ?? e));
  const buscar = () => autoUpdater.checkForUpdates().catch((e) => console.error("Actualización:", e?.message ?? e));
  buscar();
  setInterval(buscar, CADA_4_HORAS);
}

ipcMain.handle("version-lista", () => versionLista);
ipcMain.handle("instalar-actualizacion", () => {
  // quitAndInstall cierra la ventana: si hay cambios sin grabar, la app pregunta antes.
  autoUpdater.quitAndInstall(false, true);
});

app.whenReady().then(() => {
  createWindow();
  iniciarActualizaciones();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
