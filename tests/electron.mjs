// Prueba dentro de Electron real (el motor de la app instalada) contra el PostgreSQL
// local: arranque, sesión, foto desde archivo, formato PDF vertical, reporte semanal
// PDF horizontal y Excel por los diálogos de guardar de Electron.
// Uso: tests/e2e.sh electron.mjs
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { iniciarServidorRest } from "./servidor_rest.mjs";
import { png, token } from "./utilidades.mjs";

const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require("playwright");
} catch {
  playwright = require("/opt/node-tools/node_modules/playwright/index.js");
}
const { _electron } = playwright;

const RAIZ = new URL("..", import.meta.url).pathname;
const SALIDA = join(RAIZ, "capturas", "electron");
rmSync(SALIDA, { recursive: true, force: true });
mkdirSync(SALIDA, { recursive: true });
const PUERTO_REST = 5191;
const ADMIN = { id: "00000000-0000-0000-0000-00000000000a", email: "admin@prueba" };
const BACKLOG = "30000000-0000-0000-0000-000000000001"; // PS012, cambio de mangueras (semilla)

const rest = await iniciarServidorRest({
  conexion: { host: process.env.PGHOST, port: Number(process.env.PGPORT), user: "postgres", database: "postgres" },
  puerto: PUERTO_REST,
});

let paso = 0;
const ok = (t) => console.log(`ok ${++paso} - ${t}`);
const errores = [];

// Tamaño de la primera página del PDF: [ancho, alto] en puntos.
function tamanoPagina(ruta) {
  const texto = readFileSync(ruta).toString("latin1");
  const m = /\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(texto);
  if (!m) throw new Error(`Sin MediaBox en ${ruta}`);
  return [Number(m[3]) - Number(m[1]), Number(m[4]) - Number(m[2])];
}

async function esperarArchivo(ruta, ms = 20000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (existsSync(ruta) && statSync(ruta).size > 0) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`No se creó ${ruta}`);
}

const app = await _electron.launch({
  executablePath: join(RAIZ, "node_modules/electron/dist/electron"),
  args: [join(RAIZ, "dist-electron/main.js"), "--no-sandbox"],
  cwd: RAIZ,
});

try {
  // El diálogo Guardar devuelve una ruta en la carpeta de salida con el nombre propuesto.
  await app.evaluate(({ dialog, shell }, salida) => {
    dialog.showSaveDialog = async (...a) => {
      const op = a[a.length - 1];
      return { canceled: false, filePath: salida + "/" + op.defaultPath.split(/[\\/]/).pop() };
    };
    shell.openPath = async () => "";
  }, SALIDA);
  const carpetaDatos = await app.evaluate(({ app }) => app.getPath("userData"));
  if (!carpetaDatos.endsWith("Backlog HEMCO")) throw new Error(`Carpeta de datos inesperada: ${carpetaDatos}`);
  ok(`la app usa su propia carpeta de datos (${carpetaDatos.split("/").pop()}), separada de preventivos`);

  const win = await app.firstWindow();
  win.on("pageerror", (e) => errores.push(String(e)));
  await win.waitForLoadState("domcontentloaded");
  await win.context().route("**/realtime/**", (r) => r.abort());
  const sesion = {
    access_token: token(ADMIN),
    refresh_token: "prueba",
    token_type: "bearer",
    expires_at: Math.floor(Date.now() / 1000) + 86400,
    expires_in: 86400,
    user: { id: ADMIN.id, email: ADMIN.email, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
  };
  await win.evaluate(
    ([s, url]) => {
      localStorage.clear();
      localStorage.setItem("backlog.conexion", JSON.stringify({ url, anonKey: "llave-anon-de-prueba-0123456789" }));
      localStorage.setItem("sb-localhost-auth-token", JSON.stringify(s));
    },
    [sesion, `http://localhost:${PUERTO_REST}`]
  );
  await win.reload();
  await win.getByRole("heading", { name: "Backlog por equipo" }).waitFor();
  const titulo = await win.title();
  if (titulo !== "Control de Backlog - Dimelco") throw new Error(`Título de ventana: ${titulo}`);
  const funciones = await win.evaluate(() => Object.keys(window.appInfo ?? {}).sort().join(", "));
  for (const f of ["guardarArchivo", "guardarPdf", "instalarActualizacion"])
    if (!funciones.includes(f)) throw new Error(`El preload no expone ${f}: ${funciones}`);
  ok(`arranca en Electron, entra con la sesión y el preload expone ${funciones}`);

  // Foto desde archivo al ítem 1 del repuesto.
  await win.evaluate((id) => (location.hash = `#/backlog/${id}`), BACKLOG);
  await win.getByRole("heading", { name: /PS012/ }).waitFor();
  await win.getByRole("tab", { name: /^Repuestos/ }).click();
  await win.getByLabel("Fotos ítem 1").setInputFiles([{ name: "manguera.png", mimeType: "image/png", buffer: png(640, 480, [200, 120, 30]) }]);
  await win.locator(".aviso", { hasText: "1 foto(s) agregada(s)" }).waitFor();
  await win.getByRole("tab", { name: "Fotos (1)" }).waitFor();
  ok("sube una foto desde archivo al ítem 1");

  // Formato: A4 vertical, guardado por el diálogo de Electron.
  await win.getByRole("button", { name: "Imprimir formato" }).click();
  await win.locator(".aviso", { hasText: "Formato guardado en" }).waitFor({ timeout: 30000 });
  const pdfFormato = join(SALIDA, readdirSync(SALIDA).find((f) => /^BL-HEM-\d{6} PS012 .*\.pdf$/.test(f)) ?? "x");
  await esperarArchivo(pdfFormato);
  if (!readFileSync(pdfFormato).subarray(0, 5).toString().startsWith("%PDF")) throw new Error("El formato no es un PDF");
  const [anchoF, altoF] = tamanoPagina(pdfFormato);
  if (!(anchoF < altoF)) throw new Error(`El formato debía ser vertical: ${anchoF} × ${altoF}`);
  const tamFormato = statSync(pdfFormato).size;
  ok(`formato PDF A4 vertical (${Math.round(anchoF)} × ${Math.round(altoF)} pt, ${Math.round(tamFormato / 1024)} KB, con la foto)`);

  // Reporte semanal: A4 horizontal.
  await win.evaluate(() => (location.hash = "#/indicadores"));
  await win.getByRole("heading", { name: "Indicadores" }).waitFor();
  await win.getByRole("button", { name: "Reporte semanal PDF" }).click();
  await win.locator(".aviso", { hasText: "Reporte guardado en" }).waitFor({ timeout: 30000 });
  const pdfReporte = join(SALIDA, readdirSync(SALIDA).find((f) => f.startsWith("Reporte semanal backlog")) ?? "x");
  await esperarArchivo(pdfReporte);
  const [anchoR, altoR] = tamanoPagina(pdfReporte);
  if (!(anchoR > altoR)) throw new Error(`El reporte debía ser horizontal: ${anchoR} × ${altoR}`);
  ok(`reporte semanal PDF A4 horizontal (${Math.round(anchoR)} × ${Math.round(altoR)} pt)`);

  // Excel por guardarArchivo.
  await win.getByRole("button", { name: "Exportar a Excel" }).click();
  await win.locator(".aviso", { hasText: "Excel guardado en" }).waitFor({ timeout: 30000 });
  const xlsx = join(SALIDA, readdirSync(SALIDA).find((f) => f.endsWith(".xlsx")) ?? "x");
  await esperarArchivo(xlsx);
  const ExcelJS = require("exceljs");
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.readFile(xlsx);
  const filas = libro.getWorksheet("Backlogs abiertos").rowCount - 1;
  if (filas !== 5) throw new Error(`El Excel debía tener los 5 abiertos de la semilla, tiene ${filas}`);
  ok("Excel guardado con los 5 backlogs abiertos de la semilla");

  await win.screenshot({ path: join(SALIDA, "electron-indicadores.png") });

  // Paquete de órdenes: JU005 tiene un correctivo programado para mañana (semilla).
  const manana = new Date(Date.now() + 86400000);
  await win.evaluate(() => (location.hash = "#/calendario"));
  await win.getByRole("heading", { name: "Calendario" }).waitFor();
  if (manana.getDay() === 1) await win.getByRole("button", { name: "Semana siguiente" }).click();
  await win.getByRole("button", { name: /^Paquete JU005 / }).click();
  await win.getByRole("dialog").getByRole("button", { name: "Imprimir paquete" }).click();
  await win.locator(".aviso", { hasText: "PQ-HEM-000001 guardado en" }).waitFor({ timeout: 30000 });
  const pdfPaquete = join(SALIDA, readdirSync(SALIDA).find((f) => /^PQ-HEM-000001 JU005 .*\.pdf$/.test(f)) ?? "x");
  await esperarArchivo(pdfPaquete);
  const [anchoP, altoP] = tamanoPagina(pdfPaquete);
  if (!(anchoP < altoP)) throw new Error(`El paquete debía ser vertical: ${anchoP} × ${altoP}`);
  const paginas = (readFileSync(pdfPaquete).toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  if (paginas < 2) throw new Error(`El paquete debía tener carátula y formato en hojas separadas; tiene ${paginas} página(s)`);
  ok(`paquete de órdenes guardado como PDF A4 vertical de ${paginas} páginas (carátula y formato del correctivo)`);
  if (errores.length) throw new Error("Errores de página:\n" + errores.join("\n"));
  console.log(`\nPRUEBA ELECTRON OK: ${paso} pasos`);
} catch (e) {
  console.error(`\nFALLA después del paso ${paso}: ${e.message}`);
  process.exitCode = 1;
} finally {
  await app.close().catch(() => {});
  await rest.cerrar();
}
