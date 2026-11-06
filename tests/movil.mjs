// Prueba del sitio web en pantalla de celular (390 × 844, táctil) contra el PostgreSQL
// local. El sitio se compila con la conexión fija, como en GitHub Pages.
// Uso: tests/e2e.sh movil.mjs
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { iniciarServidorRest } from "./servidor_rest.mjs";
import { token } from "./utilidades.mjs";

const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require("playwright");
} catch {
  playwright = require("/opt/node-tools/node_modules/playwright/index.js");
}
const { chromium } = playwright;

const RAIZ = new URL("..", import.meta.url).pathname;
const SALIDA = join(RAIZ, "capturas", "movil");
mkdirSync(SALIDA, { recursive: true });
const PUERTO_WEB = 5193;
const PUERTO_REST = 5192; // el mismo con que se compiló dist-web (tests/e2e.sh)

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const web = createServer((req, res) => {
  let ruta = req.url.split("?")[0];
  if (ruta === "/") ruta = "/index.html";
  const archivo = join(RAIZ, "dist-web", ruta);
  if (!existsSync(archivo)) return res.writeHead(404).end();
  res.writeHead(200, { "content-type": MIME[extname(archivo)] ?? "application/octet-stream" });
  res.end(readFileSync(archivo));
});
await new Promise((r) => web.listen(PUERTO_WEB, r));
const rest = await iniciarServidorRest({
  conexion: { host: process.env.PGHOST, port: Number(process.env.PGPORT), user: "postgres", database: "postgres" },
  puerto: PUERTO_REST,
});

const USUARIOS = {
  admin: { id: "00000000-0000-0000-0000-00000000000a", email: "admin@prueba" },
  cap: { id: "00000000-0000-0000-0000-00000000000c", email: "cap@prueba" },
};
const navegador = await chromium.launch();
const errores = [];
const base = `http://localhost:${PUERTO_WEB}/`;
let paso = 0;
const ok = (t) => console.log(`ok ${++paso} - ${t}`);

async function abrir(quien) {
  const ctx = await navegador.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  if (quien) {
    const u = USUARIOS[quien];
    const sesion = {
      access_token: token(u),
      refresh_token: "prueba",
      token_type: "bearer",
      expires_at: Math.floor(Date.now() / 1000) + 86400,
      expires_in: 86400,
      user: { id: u.id, email: u.email, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
    };
    await ctx.addInitScript((s) => localStorage.setItem("sb-localhost-auth-token", JSON.stringify(s)), sesion);
  }
  await ctx.route("**/realtime/**", (r) => r.abort());
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errores.push(`${quien}: ${e}`));
  return p;
}

// Ni la página ni el área de contenido se desplazan de costado.
async function sinDesborde(p, donde) {
  const m = await p.evaluate(() => {
    const c = document.querySelector(".contenido");
    return { pagina: document.documentElement.scrollWidth - window.innerWidth, contenido: c ? c.scrollWidth - c.clientWidth : 0 };
  });
  if (m.pagina > 1 || m.contenido > 1) throw new Error(`${donde}: desborde horizontal (página ${m.pagina} px, contenido ${m.contenido} px)`);
}
const foto = (p, nombre) => p.screenshot({ path: join(SALIDA, `${nombre}.png`) });
const aviso = (p, t) => p.locator(".aviso", { hasText: t }).first().waitFor({ timeout: 8000 });

try {
  // 1. Sin sesión: la web abre directo en el login (conexión fija, sin pantalla de configuración).
  const anon = await abrir(null);
  await anon.goto(base);
  await anon.getByRole("button", { name: "Entrar" }).waitFor();
  if (await anon.getByText("Conexión a la base de datos").count()) throw new Error("La web pide la conexión");
  if (await anon.getByRole("button", { name: "Cambiar conexión a la base" }).count()) throw new Error("La web ofrece cambiar la conexión");
  const manifiesto = await (await fetch(base + "manifest.webmanifest")).json();
  if (manifiesto.short_name !== "Backlog") throw new Error("Sin manifiesto web");
  await foto(anon, "login");
  ok("la web abre en el login con la conexión fija y tiene manifiesto para la pantalla de inicio");

  // 2. Capturador: barra inferior, panel "Más" y pantallas sin desborde.
  const cap = await abrir("cap");
  await cap.goto(base);
  await cap.getByRole("heading", { name: "Backlog por equipo" }).waitFor();
  const barra = cap.getByRole("navigation", { name: "Navegación principal" });
  const botones = (await barra.locator("a, button").allTextContents()).map((t) => t.trim());
  if (botones.join("|") !== "Nuevo|Por equipo|Kanban|Más") throw new Error(`Barra inferior: ${botones.join(" | ")}`);
  if (await cap.locator("aside.menu").isVisible().then(async (v) => v && (await cap.locator("aside.menu").boundingBox()).x >= 0)) throw new Error("El menú lateral está a la vista");
  await sinDesborde(cap, "Por equipo");
  await foto(cap, "por-equipo");
  await barra.getByRole("button", { name: "Más" }).tap();
  await cap.locator("aside.menu.abierto").getByRole("link", { name: "Indicadores" }).tap();
  await cap.locator(".cabecera-movil", { hasText: "Indicadores" }).waitFor();
  if (await cap.locator("aside.menu.abierto").count()) throw new Error("El panel Más no se cerró al navegar");
  await cap.locator(".tile").first().waitFor();
  const columnasTiles = await cap.locator(".tiles").evaluate((e) => getComputedStyle(e).gridTemplateColumns.split(" ").length);
  if (columnasTiles !== 2) throw new Error(`Indicadores: ${columnasTiles} columnas de cifras`);
  await sinDesborde(cap, "Indicadores");
  await cap.waitForTimeout(400); // termina de cerrarse el panel
  await foto(cap, "indicadores");
  ok("barra inferior Nuevo / Por equipo / Kanban / Más; el panel Más navega y se cierra; Indicadores en 2 columnas sin desborde");

  // 3. Admin: Kanban por etapas y avance con botones (en el celular no se arrastra).
  const adm = await abrir("admin");
  await adm.goto(base + "#/kanban");
  await adm.getByRole("tab", { name: /^1\. Identificado/ }).waitFor();
  const luminaria = adm.getByRole("article").filter({ hasText: "Luminaria de cabina" });
  await luminaria.waitFor();
  if ((await luminaria.getAttribute("draggable")) === "true") throw new Error("Tarjeta arrastrable en el celular");
  await luminaria.locator(".tk-cabecera").tap();
  await luminaria.getByRole("button", { name: "Aprobar y planificar" }).tap();
  const dlg = adm.getByRole("dialog");
  await dlg.waitFor();
  const anchoDialogo = (await dlg.boundingBox()).width;
  if (anchoDialogo < 360) throw new Error(`Diálogo angosto en el celular: ${anchoDialogo} px`);
  await dlg.getByRole("button", { name: "Aprobar y planificar" }).tap();
  await aviso(adm, "En planificación");
  await adm.getByRole("tab", { name: /^2\. Planeado/ }).tap();
  await adm.waitForFunction(() => {
    const k = document.querySelector(".kanban");
    const col = k.children[1];
    return Math.abs(col.getBoundingClientRect().left - k.getBoundingClientRect().left) < 2;
  });
  await adm.locator('section[aria-label="Planeado"]').getByRole("article").filter({ hasText: "Luminaria de cabina" }).waitFor();
  await sinDesborde(adm, "Kanban");
  await foto(adm, "kanban");
  ok("Kanban: pestañas de etapas desplazan las columnas; aprobar y planificar con botón y diálogo a lo ancho");

  // 4. Capturador: calendario por día, ficha, HH reales y marcar ejecutado.
  await cap.goto(base + "#/calendario");
  await cap.reload();
  await cap.locator(".dias-movil").waitFor();
  if (await cap.locator(".grilla-semana").isVisible()) throw new Error("El celular muestra la grilla del calendario");
  const manana = new Date(Date.now() + 86400000);
  const lunes = (d) => { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x.toDateString(); };
  if (lunes(manana) !== lunes(new Date())) await cap.getByRole("button", { name: "Semana siguiente" }).tap();
  const centralizador = cap.locator(".dias-movil a.tarjeta-cal", { hasText: "Cambio de centralizador de barra" });
  await centralizador.waitFor();
  await sinDesborde(cap, "Calendario");
  await foto(cap, "calendario");
  await centralizador.tap();
  await cap.locator(".ficha-folio .etiqueta-estado", { hasText: "Programado" }).waitFor();
  await cap.getByRole("tab", { name: /^HH/ }).tap();
  const reales = cap.locator(".bloque-ficha", { has: cap.getByRole("heading", { name: "HH reales" }) });
  await reales.getByLabel("Especialidad nueva").selectOption({ label: "Mecánico" });
  await reales.getByLabel("Personas nuevas").fill("2");
  await reales.getByLabel("Horas nuevas").fill("4.5");
  await reales.getByRole("button", { name: "Agregar" }).tap();
  await reales.getByText("9", { exact: true }).first().waitFor();
  await sinDesborde(cap, "Ficha HH");
  await foto(cap, "ficha-hh");
  await cap.locator(".ficha-acciones").getByRole("button", { name: "Marcar ejecutado" }).tap();
  const dlgE = cap.getByRole("dialog");
  await dlgE.getByLabel(/Comentario/).fill("Cambiado el centralizador, probado en frente");
  await dlgE.getByRole("button", { name: "Marcar ejecutado" }).tap();
  await cap.locator(".ficha-folio .etiqueta-estado", { hasText: "Ejecutado" }).waitFor();
  await foto(cap, "ficha-ejecutado");
  ok("calendario por día en el celular; desde la ficha carga 9 HH reales y marca ejecutado");

  if (errores.length) throw new Error("Errores de página:\n" + errores.join("\n"));
  console.log(`\nPRUEBA MOVIL OK: ${paso} pasos`);
} catch (e) {
  console.error(`\nFALLA después del paso ${paso}: ${e.message}`);
  process.exitCode = 1;
} finally {
  await navegador.close();
  web.close();
  await rest.cerrar();
}
