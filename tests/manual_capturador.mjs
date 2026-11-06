// Capturas para el manual del capturador (docs/manual). Recorre la app real con la
// semilla de prueba como «Carlos Capturador» (HEMCO) y guarda cada pantalla.
// Uso: tests/e2e.sh manual_capturador.mjs   y luego   node tools/armar_manual.mjs
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
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
const IMG = join(RAIZ, "docs", "manual", "img");
rmSync(IMG, { recursive: true, force: true });
mkdirSync(IMG, { recursive: true });
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
const base = `http://localhost:${PUERTO_APP}/`;
const CAP = { id: "00000000-0000-0000-0000-00000000000c", email: "cap@prueba" };

const navegador = await chromium.launch();
let n = 0;

async function contexto({ conSesion = true, ancho = 1366, alto = 860, movil = false } = {}) {
  const ctx = await navegador.newContext({
    viewport: { width: ancho, height: alto },
    deviceScaleFactor: 2,
    ...(movil ? { isMobile: true, hasTouch: true } : {}),
  });
  const sesion = {
    access_token: token(CAP),
    refresh_token: "prueba",
    token_type: "bearer",
    expires_at: Math.floor(Date.now() / 1000) + 86400,
    expires_in: 86400,
    user: { id: CAP.id, email: CAP.email, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
  };
  await ctx.addInitScript(
    ([s, url, con]) => {
      localStorage.setItem("backlog.conexion", JSON.stringify({ url, anonKey: "llave-anon-de-prueba-0123456789" }));
      if (con) localStorage.setItem("sb-localhost-auth-token", JSON.stringify(s));
    },
    [sesion, `http://localhost:${PUERTO_REST}`, conSesion]
  );
  await ctx.route("**/realtime/**", (r) => r.abort());
  const p = await ctx.newPage();
  p.on("pageerror", (e) => console.log("error de página:", e.message));
  return p;
}

// Marca en rojo los elementos que explica cada paso del manual.
async function marcar(p, ...locs) {
  for (const l of locs)
    await l.evaluateAll((els) =>
      els.forEach((e) => {
        e.dataset.marcaManual = "1";
        e.style.outline = "3px solid #e00000";
        e.style.outlineOffset = "3px";
        e.style.borderRadius = e.style.borderRadius || "4px";
      })
    );
}
async function limpiar(p) {
  await p.evaluate(() =>
    document.querySelectorAll("[data-marca-manual]").forEach((e) => {
      e.style.outline = "";
      e.style.outlineOffset = "";
      delete e.dataset.marcaManual;
    })
  );
}
async function foto(p, nombre, { loc, completa = false } = {}) {
  n++;
  const archivo = join(IMG, `${String(n).padStart(2, "0")}-${nombre}.jpg`);
  await p.waitForTimeout(250);
  // Sin servidor de tiempo real en la prueba: el pie se muestra como en uso normal.
  await p.evaluate(() => {
    const pie = document.querySelector(".pie-estado");
    if (!pie) return;
    const punto = pie.querySelector(".punto-conexion");
    if (punto) punto.className = "punto-conexion en_linea";
    for (const n of pie.childNodes) if (n.nodeType === 3 && n.textContent.trim()) n.textContent = "En línea";
  });
  if (loc) await loc.screenshot({ path: archivo, type: "jpeg", quality: 82 });
  else await p.screenshot({ path: archivo, type: "jpeg", quality: 82, fullPage: completa });
  console.log(`captura ${archivo.split("/").pop()}`);
  await limpiar(p);
}
// Un select se muestra abierto (como lista) para la captura.
async function abrirLista(loc, filas = 8) {
  await loc.evaluate((s, f) => {
    const filas = Math.min(f, s.options.length + s.querySelectorAll("optgroup").length);
    s.setAttribute("size", String(filas));
    s.style.height = `${filas * 26 + 10}px`;
  }, filas);
}
async function cerrarLista(loc) {
  await loc.evaluate((s) => {
    s.removeAttribute("size");
    s.style.height = "";
  });
}
async function aviso(p, texto) {
  await p.locator(".aviso", { hasText: texto }).first().waitFor({ timeout: 8000 });
}

// Fotos de ejemplo con texto, generadas en el navegador.
async function imagenEjemplo(texto, color) {
  const p = await navegador.newPage({ viewport: { width: 640, height: 480 } });
  await p.setContent(`<body style="margin:0;display:grid;place-items:center;height:100vh;background:linear-gradient(135deg,${color},#222);font:bold 34px Segoe UI,Arial;color:#fff;text-align:center">${texto}</body>`);
  const b = await p.screenshot({ type: "png" });
  await p.close();
  return b;
}

try {
  // 1. Entrar
  const login = await contexto({ conSesion: false });
  await login.goto(base);
  await login.getByRole("button", { name: "Entrar" }).waitFor();
  await login.getByLabel("Correo").fill("planeador.martha@grupodimelco.com");
  await login.getByLabel("Contraseña").fill("••••••••••");
  await marcar(login, login.locator("form, .tarjeta-login").first());
  await foto(login, "login");

  const p = await contexto();
  await p.goto(base + "#/flota");
  await p.getByRole("heading", { name: "Por equipo" }).waitFor();
  await p.waitForTimeout(600);
  await foto(p, "inicio-por-equipo");
  await marcar(p, p.locator("aside, .menu-lateral").first());
  await foto(p, "menu", { loc: p.locator("aside, .menu-lateral").first() });

  // 2. Nuevo backlog
  await p.goto(base + "#/nuevo");
  await p.getByRole("heading", { name: "Nuevo backlog" }).waitFor();
  await p.waitForTimeout(500);
  await marcar(p, p.locator(".barra-acciones .nota").last());
  await foto(p, "nuevo-vacio");

  const equipo = p.getByLabel("Equipo", { exact: true });
  await abrirLista(equipo, 9);
  await marcar(p, equipo);
  await foto(p, "nuevo-lista-equipos", { loc: p.locator(".panel-formulario").first() });
  await cerrarLista(equipo);
  await equipo.selectOption({ label: "PS011 · ST1030" });
  await p.locator(".datos-equipo", { hasText: "Epiroc" }).waitFor();
  await marcar(p, p.locator(".datos-equipo"));
  await foto(p, "nuevo-equipo-elegido", { loc: p.locator(".panel-formulario").first() });

  await p.getByLabel("Reportado por").fill("Xavier Araica");
  await p.getByLabel("Aprobado por").fill("Luis Mena");
  await p.getByText("Urgente", { exact: true }).click();
  await p.getByLabel("Prioridad").selectOption("P2");
  await marcar(p, p.getByLabel("Reportado por"), p.getByLabel("Aprobado por"), p.locator(".opciones-radio"), p.getByLabel("Prioridad"));
  await foto(p, "nuevo-encabezado", { loc: p.locator(".panel-formulario").first() });

  const sistema = p.getByLabel("Sistema", { exact: true });
  await abrirLista(sistema, 6);
  await marcar(p, sistema);
  await foto(p, "nuevo-lista-sistemas", { loc: p.locator(".panel-formulario").first() });
  await cerrarLista(sistema);
  await sistema.selectOption({ label: "Otro" });
  await p.getByLabel("¿Cuál sistema?").fill("Sistema de supresión de incendios");
  await marcar(p, sistema, p.getByLabel("¿Cuál sistema?"));
  await foto(p, "nuevo-sistema-otro", { loc: p.locator(".panel-formulario").first() });
  await sistema.selectOption({ label: "Sistema hidráulico" });
  await p.getByLabel("Origen").selectOption("Inspección");
  await p.getByLabel("Aviso SAP (si existe)").fill("10458732");
  await marcar(p, sistema, p.getByLabel("Origen"), p.getByLabel("Aviso SAP (si existe)"));
  await foto(p, "nuevo-sistema-origen", { loc: p.locator(".panel-formulario").first() });

  const trabajo = p.locator(".panel-formulario", { has: p.getByRole("heading", { name: "Trabajo" }) });
  await p.getByLabel("Descripción del trabajo").fill("Reempaque de block de implementos por fugas de aceite");
  await p.getByLabel("Componente", { exact: true }).fill("Block de implementos");
  await p.getByLabel("Horómetro (h)").fill("12450");
  await marcar(p, trabajo);
  await foto(p, "nuevo-trabajo", { loc: trabajo });

  const REP = [
    ["6060003007", "2", "", "Juego de cierres EOD"],
    ["6060013890", "2", "", "Kit de retenes (dirección)"],
    ["6060015161", "4", "1", "Kit de sellos"],
  ];
  for (const [i, [parte, cant, stock, desc]] of REP.entries()) {
    await p.getByRole("button", { name: "Agregar repuesto" }).click();
    await p.getByLabel(`Número de parte ítem ${i + 1}`).fill(parte);
    await p.getByLabel(`Cantidad ítem ${i + 1}`).fill(cant);
    if (stock) await p.getByLabel(`Stock ítem ${i + 1}`).fill(stock);
    await p.getByLabel(`Descripción ítem ${i + 1}`).fill(desc);
    await p.getByLabel(`Componente ítem ${i + 1}`).fill("Block de implementos");
  }
  await p.getByLabel("Observaciones ítem 3").fill("Hay 1 en bodega");
  const repuestos = p.locator(".panel-formulario", { has: p.getByRole("heading", { name: "Repuestos" }) });
  await marcar(p, p.getByRole("button", { name: "Agregar repuesto" }));
  await foto(p, "nuevo-repuestos", { loc: repuestos });

  await p.getByRole("button", { name: "Agregar especialidad" }).click();
  await p.locator(".fila-hh").nth(0).getByLabel("Especialidad").selectOption({ label: "Mecánico" });
  await p.locator(".fila-hh").nth(0).getByLabel("Personas").fill("2");
  await p.locator(".fila-hh").nth(0).getByLabel("Horas").fill("4");
  await p.getByRole("button", { name: "Agregar especialidad" }).click();
  await p.locator(".fila-hh").nth(1).getByLabel("Especialidad").selectOption({ label: "Electromecánico" });
  await p.locator(".fila-hh").nth(1).getByLabel("Personas").fill("1");
  await p.locator(".fila-hh").nth(1).getByLabel("Horas").fill("2");
  const hh = p.locator(".panel-formulario", { has: p.getByRole("heading", { name: "Especialidades y HH" }) });
  await marcar(p, p.locator(".hh-total"), hh.locator("strong"));
  await foto(p, "nuevo-hh", { loc: hh });

  await p.getByLabel("Archivos de fotos").setInputFiles([
    { name: "fuga-block.png", mimeType: "image/png", buffer: await imagenEjemplo("Fuga en block<br>de implementos", "#7a3b1d") },
  ]);
  const pegada = await imagenEjemplo("Vista general<br>PS011", "#1d4f7a");
  await p.evaluate((b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], "image.png", { type: "image/png" }));
    document.body.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
  }, pegada.toString("base64"));
  await p.locator(".lista-archivos li").nth(1).waitFor();
  const fotos = p.locator(".panel-formulario", { has: p.getByRole("heading", { name: "Fotos" }) });
  await marcar(p, p.getByRole("button", { name: "Agregar fotos" }), fotos.locator(".solo-escritorio"));
  await foto(p, "nuevo-fotos", { loc: fotos });

  await p.getByPlaceholder("Por qué hay que hacer el trabajo").fill(
    "Fugas de aceite en el block de implementos; si no se corrige se pierde presión de levante y hay riesgo de daño a la bomba."
  );
  await marcar(p, p.getByRole("button", { name: "Registrar backlog" }));
  await foto(p, "nuevo-justificacion-registrar", { loc: p.locator(".pagina-formulario") });
  await p.setViewportSize({ width: 1366, height: 2300 });
  await foto(p, "nuevo-completo", { completa: true });
  await p.setViewportSize({ width: 1366, height: 860 });

  await p.getByRole("button", { name: "Registrar backlog" }).click();
  await p.locator(".ficha-folio .etiqueta-estado", { hasText: "Identificado" }).waitFor({ timeout: 10000 });
  await p.waitForTimeout(600);
  const id = p.url().split("/backlog/")[1];
  await marcar(p, p.locator(".ficha-folio"), p.locator(".ficha-acciones"));
  await foto(p, "ficha-datos");
  await p.getByRole("tab", { name: /^Repuestos/ }).click();
  await foto(p, "ficha-repuestos");
  await p.getByRole("tab", { name: /^HH/ }).click();
  await foto(p, "ficha-hh");
  await p.getByRole("tab", { name: /^Fotos/ }).click();
  await p.waitForFunction(() => [...document.querySelectorAll(".rejilla-fotos img")].every((i) => i.complete && i.naturalWidth > 0));
  await foto(p, "ficha-fotos");
  await p.getByRole("tab", { name: /^Bitácora/ }).click();
  await p.getByLabel("Comentario").fill("Se solicitó cotización de los kits a bodega central");
  await p.getByRole("button", { name: "Comentar" }).click();
  await p.locator(".evento-texto", { hasText: "cotización" }).waitFor();
  await marcar(p, p.locator(".comentar"));
  await foto(p, "ficha-bitacora");

  // Formato impreso
  await p.getByRole("tab", { name: "Datos" }).click();
  const [ventana] = await Promise.all([p.context().waitForEvent("page"), p.getByRole("button", { name: "Imprimir formato" }).click()]);
  await ventana.waitForFunction(() => document.title && !document.title.startsWith("Generando"));
  await ventana.setViewportSize({ width: 900, height: 1270 });
  await ventana.waitForTimeout(500);
  await foto(ventana, "formato-impreso");
  await ventana.close();

  // Borrar (se cancela)
  await p.getByRole("button", { name: "Borrar", exact: true }).click();
  await p.getByRole("dialog").getByLabel("Motivo del borrado").fill("Registrado dos veces (duplicado de BL-HEM-000002)");
  await foto(p, "borrar-dialogo");
  await p.getByRole("dialog").getByRole("button", { name: "Cancelar" }).click();

  // Kanban
  await p.goto(base + "#/kanban");
  await p.locator(".tarjeta-kanban").first().waitFor();
  await p.waitForTimeout(500);
  await foto(p, "kanban");
  const tarjeta = p.locator(".tarjeta-kanban", { hasText: "Reempaque de block" });
  await tarjeta.click();
  await p.waitForTimeout(500);
  await marcar(p, tarjeta);
  await foto(p, "kanban-tarjeta", { loc: tarjeta });

  // Por equipo desplegado
  await p.goto(base + "#/flota");
  await p.getByRole("heading", { name: "Por equipo" }).waitFor();
  const ps011 = p.locator(".tarjeta-equipo, article", { hasText: "PS011" }).first();
  await ps011.click().catch(() => {});
  await p.waitForTimeout(500);
  await foto(p, "por-equipo-desplegado");

  // Ejecutar un backlog programado (semilla: JU005 centralizador)
  await p.goto(base + "#/backlog/30000000-0000-0000-0000-000000000004");
  await p.locator(".ficha-folio .etiqueta-estado", { hasText: "Programado" }).waitFor();
  await p.getByRole("tab", { name: /^HH/ }).click();
  const reales = p.locator(".bloque-ficha", { has: p.getByRole("heading", { name: "HH reales" }) });
  await reales.getByLabel("Especialidad nueva").selectOption({ label: "Mecánico" });
  await reales.getByLabel("Personas nuevas").fill("2");
  await reales.getByLabel("Horas nuevas").fill("3.5");
  await marcar(p, reales);
  await foto(p, "ejecutar-hh-reales");
  await reales.getByRole("button", { name: "Agregar" }).click();
  await reales.getByText("7", { exact: true }).first().waitFor();
  await p.locator(".ficha-acciones").getByRole("button", { name: "Marcar ejecutado", exact: true }).click();
  const dlg = p.getByRole("dialog");
  await dlg.getByLabel(/Comentario/).fill("Se cambió el centralizador y se probó la perforación");
  await foto(p, "ejecutar-dialogo");
  await dlg.getByRole("button", { name: "Marcar ejecutado", exact: true }).click();
  await p.locator(".ficha-folio .etiqueta-estado", { hasText: "Ejecutado" }).waitFor();
  await p.waitForTimeout(400);
  await marcar(p, p.locator(".ficha-folio"));
  await foto(p, "ejecutar-resultado");

  // Calendario, indicadores, capacidad
  await p.goto(base + "#/calendario");
  await p.getByRole("heading", { name: "Calendario" }).waitFor();
  await p.waitForTimeout(600);
  await foto(p, "calendario");
  await p.goto(base + "#/indicadores");
  await p.getByRole("heading", { name: "Indicadores" }).waitFor();
  await p.waitForTimeout(800);
  await foto(p, "indicadores");
  await p.goto(base + "#/capacidad");
  await p.getByRole("button", { name: "Cambiar Mecánico HEMCO" }).click();
  await p.getByLabel("Personas Mecánico").fill("3");
  await p.getByLabel("Horas por turno Mecánico").fill("10");
  await p.getByLabel("Turnos Mecánico").fill("2");
  await marcar(p, p.locator("tr", { has: p.getByLabel("Personas Mecánico") }));
  await foto(p, "capacidad");

  // Cambiar contraseña
  await p.getByRole("button", { name: "Cambiar contraseña" }).click();
  await p.getByRole("dialog").waitFor();
  await foto(p, "cambiar-contrasena");
  await p.keyboard.press("Escape");

  // Celular
  const m = await contexto({ ancho: 390, alto: 844, movil: true });
  await m.goto(base + "#/flota");
  await m.getByRole("heading", { name: "Por equipo" }).waitFor().catch(() => {});
  await m.waitForTimeout(800);
  await foto(m, "movil-inicio");
  await m.goto(base + "#/nuevo");
  await m.waitForTimeout(800);
  await foto(m, "movil-nuevo");
  await m.goto(base + "#/kanban");
  await m.locator(".tarjeta-kanban").first().waitFor();
  await m.waitForTimeout(500);
  await foto(m, "movil-kanban");
  await m.goto(base + `#/backlog/${id}`);
  await m.waitForTimeout(800);
  await foto(m, "movil-ficha");

  console.log(`\nMANUAL OK: ${n} capturas en docs/manual/img`);
} catch (e) {
  console.error("FALLA:", e.message);
  process.exitCode = 1;
} finally {
  await navegador.close();
  estatico.close();
  await rest.cerrar();
}
