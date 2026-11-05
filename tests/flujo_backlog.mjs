// Prueba de extremo a extremo del registro y la ficha del backlog.
// La app construida (dist/) habla con tests/servidor_rest.mjs, que ejecuta cada
// llamada en el PostgreSQL local con el rol y el usuario de la sesión.
// Uso: tests/e2e.sh (levanta la base, aplica migraciones y semilla, y corre esto).
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { iniciarServidorRest } from "./servidor_rest.mjs";

const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require("playwright");
} catch {
  playwright = require("/opt/node-tools/node_modules/playwright/index.js");
}
const { chromium } = playwright;

const RAIZ = new URL("..", import.meta.url).pathname;
const SALIDA = join(RAIZ, "capturas");
mkdirSync(SALIDA, { recursive: true });
const PUERTO_APP = 5189;
const PUERTO_REST = 5190;

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };
const estatico = createServer((req, res) => {
  let ruta = req.url.split("?")[0];
  if (ruta === "/") ruta = "/index.html";
  const archivo = join(RAIZ, "dist", ruta);
  if (!existsSync(archivo)) return res.writeHead(404).end();
  res.writeHead(200, { "content-type": MIME[extname(archivo)] ?? "application/octet-stream" });
  res.end(readFileSync(archivo));
});
await new Promise((r) => estatico.listen(PUERTO_APP, r));
const rest = await iniciarServidorRest({
  conexion: { host: process.env.PGHOST, port: Number(process.env.PGPORT), user: "postgres", database: "postgres" },
  puerto: PUERTO_REST,
});

const USUARIOS = {
  admin: { id: "00000000-0000-0000-0000-00000000000a", email: "admin@prueba" },
  cap: { id: "00000000-0000-0000-0000-00000000000c", email: "cap@prueba" },
};

function token(u) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const exp = Math.floor(Date.now() / 1000) + 86400;
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: u.id, role: "authenticated", email: u.email, exp })}.prueba`;
}

const navegador = await chromium.launch();
const errores = [];
const paginas = [];

async function abrir(quien, ancho = 1366, alto = 860) {
  const u = USUARIOS[quien];
  const ctx = await navegador.newContext({ viewport: { width: ancho, height: alto } });
  const sesion = {
    access_token: token(u),
    refresh_token: "prueba",
    token_type: "bearer",
    expires_at: Math.floor(Date.now() / 1000) + 86400,
    expires_in: 86400,
    user: { id: u.id, email: u.email, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
  };
  await ctx.addInitScript(
    ([s, url]) => {
      localStorage.setItem("backlog.conexion", JSON.stringify({ url, anonKey: "llave-anon-de-prueba-0123456789" }));
      localStorage.setItem("sb-localhost-auth-token", JSON.stringify(s));
    },
    [sesion, `http://localhost:${PUERTO_REST}`]
  );
  await ctx.route("**/realtime/**", (r) => r.abort());
  const pagina = await ctx.newPage();
  paginas.push([quien, pagina]);
  pagina.on("pageerror", (e) => errores.push(`${quien}: ${e}`));
  return pagina;
}

let paso = 0;
function ok(texto) {
  paso++;
  console.log(`ok ${paso} - ${texto}`);
}
async function esperarEstado(p, estado) {
  await p.locator(".ficha-folio .etiqueta-estado", { hasText: estado }).waitFor({ timeout: 8000 });
}
async function transicion(p, boton, rellenar) {
  await p.locator(".ficha-acciones").getByRole("button", { name: boton, exact: true }).click();
  const d = p.getByRole("dialog");
  await d.waitFor();
  if (rellenar) await rellenar(d);
  await d.getByRole("button", { name: boton, exact: true }).click();
}
async function aviso(p, texto) {
  await p.locator(".aviso", { hasText: texto }).first().waitFor({ timeout: 8000 });
}
const base = `http://localhost:${PUERTO_APP}/`;
const enDias = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

try {
  // 1. El capturador registra un backlog con HH estimadas.
  const cap = await abrir("cap");
  await cap.goto(base + "#/nuevo");
  await cap.getByRole("heading", { name: "Nuevo backlog" }).waitFor();
  await cap.getByLabel("Equipo", { exact: true }).fill("scoop");
  const equipoElegido = cap.getByLabel("Equipo elegido");
  await cap.waitForFunction(() => document.querySelectorAll("select[size] option").length === 2);
  const opciones = await equipoElegido.locator("option").allTextContents();
  if (opciones.some((t) => t.includes("Scooptram #9"))) throw new Error("El capturador de HEMCO ve equipos de Veta Nueva");
  ok("el buscador filtra equipos y el capturador solo ve su unidad");
  await equipoElegido.selectOption({ label: "Scooptram #1 · ST1030" });
  await cap.getByLabel("Sistema").selectOption({ label: "Sistema hidráulico" });
  await cap.getByLabel("Descripción del hallazgo").fill("Fuga en cilindro de levante izquierdo, sello dañado");
  await cap.getByLabel("Reportado por").fill("J. Pérez");
  await cap.getByRole("button", { name: "Agregar especialidad" }).click();
  await cap.locator(".fila-hh").getByLabel("Especialidad").selectOption({ label: "Mecánico" });
  await cap.locator(".fila-hh").getByLabel("Personas").fill("2");
  await cap.locator(".fila-hh").getByLabel("Horas").fill("4");
  await cap.screenshot({ path: join(SALIDA, "nuevo-backlog.png"), fullPage: true });
  await cap.getByRole("button", { name: "Registrar backlog" }).click();
  await esperarEstado(cap, "Identificado");
  const id = cap.url().split("/backlog/")[1];
  const folio = await cap.locator(".ficha-folio").textContent();
  if (!folio.includes("BL-HEM-000001")) throw new Error(`Folio inesperado: ${folio}`);
  ok("registro crea BL-HEM-000001 y abre la ficha");
  if (await cap.locator(".ficha-acciones button").count()) throw new Error("El capturador ve acciones de admin en Identificado");
  await cap.getByRole("tab", { name: /^HH/ }).click();
  await cap.getByText("8", { exact: true }).first().waitFor();
  ok("HH estimadas grabadas (2 x 4 = 8) y sin botones de estado para el capturador");

  // 2. El admin aprueba, carga repuestos y la base bloquea pasar a Listo con repuestos pendientes.
  const adm = await abrir("admin");
  await adm.goto(base + `#/backlog/${id}`);
  await esperarEstado(adm, "Identificado");
  await transicion(adm, "Aprobar y planificar", (d) => d.getByLabel("Prioridad confirmada").selectOption("P2"));
  await esperarEstado(adm, "En planificación");
  await adm.locator(".etiqueta-prioridad", { hasText: "P2" }).waitFor();
  ok("admin aprueba con prioridad P2");
  await adm.getByRole("tab", { name: /^Repuestos/ }).click();
  await adm.getByLabel("Código SAP nuevo").fill("100234");
  await adm.getByLabel("Descripción nueva").fill("Kit de sellos cilindro de levante");
  await adm.getByRole("button", { name: "Agregar", exact: true }).click();
  await adm.getByRole("cell", { name: "100234" }).waitFor();
  await transicion(adm, "Listo para programar");
  await aviso(adm, "Faltan 1 repuesto");
  await adm.getByRole("dialog").getByRole("button", { name: "Cancelar" }).click();
  ok("la base rechaza «Listo para programar» con un repuesto sin recibir y la app muestra el motivo");
  await transicion(adm, "Pasar a esperar repuestos");
  await esperarEstado(adm, "Esperando repuestos");
  await adm.getByLabel("Solicitud 100234").fill("10045678");
  await adm.getByLabel("Solicitud 100234").blur();
  await adm.getByLabel("Estado 100234").selectOption("Recibido");
  await esperarEstado(adm, "Listo para programar");
  ok("al recibir el último repuesto pasa solo a «Listo para programar»");

  // 3. Programar.
  await transicion(adm, "Programar", async (d) => {
    await d.getByLabel("Fecha programada").fill(enDias(1));
    await d.getByLabel("OT SAP").fill("4001234");
    await d.getByLabel("Aprovechar la parada de un PM").check();
  });
  await esperarEstado(adm, "Programado");
  ok("admin programa con fecha, OT y aprovechando PM");

  // 4. El capturador carga HH reales y marca ejecutado.
  await cap.reload();
  await esperarEstado(cap, "Programado");
  await cap.getByRole("tab", { name: /^HH/ }).click();
  const reales = cap.locator(".bloque-ficha", { has: cap.getByRole("heading", { name: "HH reales" }) });
  await reales.getByLabel("Especialidad nueva").selectOption({ label: "Mecánico" });
  await reales.getByLabel("Personas nuevas").fill("2");
  await reales.getByLabel("Horas nuevas").fill("5");
  await reales.getByRole("button", { name: "Agregar" }).click();
  await reales.getByText("10", { exact: true }).first().waitFor();
  if (await cap.locator(".ficha-acciones").getByRole("button", { name: "Reprogramar" }).count())
    throw new Error("El capturador ve Reprogramar");
  await transicion(cap, "Marcar ejecutado", (d) => d.getByLabel(/Comentario/).fill("Se cambiaron sellos y se probó el levante"));
  await esperarEstado(cap, "Ejecutado");
  ok("capturador carga 10 HH reales y marca ejecutado");

  // 5. El admin cierra; la ficha queda de solo lectura.
  await adm.reload();
  await esperarEstado(adm, "Ejecutado");
  await transicion(adm, "Cerrar");
  await esperarEstado(adm, "Cerrado");
  if (await adm.locator(".ficha-acciones button").count()) throw new Error("Quedan acciones en un backlog cerrado");
  await adm.getByRole("tab", { name: "Datos" }).click();
  if (!(await adm.locator("label.campo", { hasText: "Descripción" }).locator("textarea").isDisabled()))
    throw new Error("Datos editables en un backlog cerrado");
  const deteccion = await adm.locator("label.campo", { hasText: "Fecha de detección" }).locator("input").inputValue();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(deteccion)) throw new Error(`Fecha de detección vacía o mal formada: «${deteccion}»`);
  ok("admin cierra y la ficha queda de solo lectura");

  await adm.getByRole("tab", { name: /^Bitácora/ }).click();
  const eventos = await adm.locator(".bitacora .evento").count();
  if (eventos !== 7) throw new Error(`La bitácora debía tener 7 eventos, tiene ${eventos}`);
  await adm.locator(".evento-texto", { hasText: "Automático: todos los repuestos recibidos" }).waitFor();
  ok("bitácora con 7 eventos, incluido el paso automático");
  await adm.screenshot({ path: join(SALIDA, "ficha-bitacora.png"), fullPage: true });
  await adm.getByRole("tab", { name: "Datos" }).click();
  await adm.screenshot({ path: join(SALIDA, "ficha-datos.png"), fullPage: true });

  // 6. Vista de celular.
  const movil = await abrir("cap", 390, 844);
  await movil.goto(base + `#/backlog/${id}`);
  await esperarEstado(movil, "Cerrado");
  await movil.screenshot({ path: join(SALIDA, "ficha-390.png"), fullPage: true });
  await movil.goto(base + "#/nuevo");
  await movil.getByRole("heading", { name: "Nuevo backlog" }).waitFor();
  await movil.screenshot({ path: join(SALIDA, "nuevo-390.png"), fullPage: true });

  if (errores.length) throw new Error("Errores de página:\n" + errores.join("\n"));
  console.log(`\nPRUEBA OK: ${paso} pasos`);
} catch (e) {
  console.error(`\nFALLA después del paso ${paso}: ${e.message}`);
  for (const [i, [quien, p]] of paginas.entries()) {
    await p.screenshot({ path: join(SALIDA, `falla-${i}-${quien}.png`), fullPage: true }).catch(() => {});
  }
  if (errores.length) console.error(errores.join("\n"));
  process.exitCode = 1;
} finally {
  await navegador.close();
  estatico.close();
  await rest.cerrar();
}
