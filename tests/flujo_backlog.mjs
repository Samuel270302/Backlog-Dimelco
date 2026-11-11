// Prueba de extremo a extremo del registro y la ficha del backlog.
// La app construida (dist/) habla con tests/servidor_rest.mjs, que ejecuta cada
// llamada en el PostgreSQL local con el rol y el usuario de la sesión.
// Uso: tests/e2e.sh (levanta la base, aplica migraciones y semilla, y corre esto).
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { iniciarServidorRest } from "./servidor_rest.mjs";
import { png, token } from "./utilidades.mjs";

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
  capVtn: { id: "00000000-0000-0000-0000-00000000000d", email: "cap.vtn@prueba" },
  capExp: { id: "00000000-0000-0000-0000-00000000000b", email: "sara.lira@explotec.com" },
};


const FOTO = (nombre, color) => ({ name: nombre, mimeType: "image/png", buffer: png(320, 240, color) });

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
  pagina.on("response", async (r) => {
    if (r.status() >= 400 && r.url().includes("/rest/v1/"))
      console.log(`  [${quien}] ${r.status()} ${r.request().method()} ${decodeURIComponent(r.url().split("/rest/v1/")[1]).slice(0, 90)} ${(await r.text().catch(() => "")).slice(0, 160)}`);
  });
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
  // 1. El capturador registra el caso del formato de ejemplo (N° 105, PS011) en un solo formulario.
  const REPUESTOS = [
    ["6060003007", "2", "", "Juego de cierres EOD"],
    ["6060013890", "2", "", "KIT DE RETENES (Dirección)"],
    ["5541120900", "2", "", "JUEGO CIERRES"],
    ["6060015161", "4", "1", "Kit de sellos"],
  ];
  const cap = await abrir("cap");
  await cap.goto(base + "#/nuevo");
  await cap.getByRole("heading", { name: "Nuevo backlog" }).waitFor();
  const equipoElegido = cap.getByLabel("Equipo", { exact: true });

  await equipoElegido.locator("option", { hasText: "PS011" }).waitFor({ state: "attached" });
  const grupos = await equipoElegido.locator("optgroup").evaluateAll((g) => g.map((x) => x.label));
  if (grupos.join("|") !== "Jumbo Boomer S1D|Scooptram ST1030") throw new Error(`Grupos de la lista de equipos: ${grupos.join("|")}`);
  const opciones = await equipoElegido.locator("option").allTextContents();
  if (opciones.some((t) => t.includes("PS090"))) throw new Error("El capturador de HEMCO ve equipos de Veta Nueva");
  ok("el equipo se elige en una lista desplegable agrupada por familia, solo de su unidad");
  await equipoElegido.selectOption({ label: "PS011 · ST1030" });
  await cap.locator(".datos-equipo", { hasText: "Epiroc" }).waitFor();
  const sistemasOfrecidos = (await cap.getByLabel("Sistema", { exact: true }).locator("option").allTextContents()).slice(1);
  if (sistemasOfrecidos.join("|") !== "Motor diésel|Frenos|Sistema hidráulico|Otro") throw new Error(`Sistemas de la familia: ${sistemasOfrecidos.join("|")}`);
  await cap.getByLabel("Sistema", { exact: true }).selectOption({ label: "Otro" });
  await cap.getByLabel("¿Cuál sistema?").waitFor();
  if (!(await cap.locator(".barra-acciones .nota", { hasText: "cuál es el sistema" }).count())) throw new Error("Otro sin texto no pide cuál");
  ok("el Scoop ofrece solo Motor diésel, Frenos, Sistema hidráulico y Otro; Otro pide cuál");
  await cap.getByLabel("Sistema", { exact: true }).selectOption({ label: "Sistema hidráulico" });
  if (await cap.getByLabel("¿Cuál sistema?").count()) throw new Error("Queda el campo de Otro");
  if ((await cap.getByLabel("Reportado por").inputValue()) !== "") throw new Error("Reportado por debe empezar vacío");
  await cap.getByLabel("Reportado por").fill("Xavier Araica");
  await cap.getByLabel("Aprobado por").fill("Luis Mena");
  if (!(await cap.getByLabel("Aviso SAP (si existe)").count())) throw new Error("HEMCO debe pedir Aviso SAP");
  await cap.getByLabel("Descripción del trabajo").fill("Reempaque de block de implementos por fugas de aceite");
  await cap.getByLabel("Componente", { exact: true }).fill("Block de implementos");
  await cap.getByLabel("Horómetro (h)").fill("12450");
  for (const [i, [parte, cant, stock, desc]] of REPUESTOS.entries()) {
    await cap.getByRole("button", { name: "Agregar repuesto" }).click();
    await cap.getByLabel(`Número de parte ítem ${i + 1}`).fill(parte);
    await cap.getByLabel(`Cantidad ítem ${i + 1}`).fill(cant);
    if (stock) await cap.getByLabel(`Stock ítem ${i + 1}`).fill(stock);
    await cap.getByLabel(`Descripción ítem ${i + 1}`).fill(desc);
    await cap.getByLabel(`Componente ítem ${i + 1}`).fill("Block de implementos");
  }
  await cap.getByRole("button", { name: "Agregar especialidad" }).click();
  await cap.locator(".fila-hh").getByLabel("Especialidad").selectOption({ label: "Mecánico" });
  await cap.locator(".fila-hh").getByLabel("Personas").fill("2");
  await cap.locator(".fila-hh").getByLabel("Horas").fill("4");
  await cap.getByPlaceholder("Por qué hay que hacer el trabajo").fill("Fugas de aceite en el block de implementos; riesgo de daño a bombas.");
  await cap.getByLabel("Archivos de fotos").setInputFiles([FOTO("fuga-block.png", [180, 40, 40])]);
  await cap.locator(".lista-archivos li").first().waitFor();
  // La segunda foto se pega con Ctrl+V (evento de pegado con una imagen en el portapapeles).
  const vistaGeneral = FOTO("vista-general.png", [40, 90, 160]);
  await cap.evaluate(
    ({ nombre, b64 }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], nombre, { type: "image/png" }));
      document.body.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
    },
    { nombre: vistaGeneral.name, b64: vistaGeneral.buffer.toString("base64") }
  );
  await cap.locator(".lista-archivos li").nth(1).waitFor();
  ok("una foto desde archivo y otra pegada con Ctrl+V");
  await cap.setViewportSize({ width: 1366, height: 1500 });
  await cap.screenshot({ path: join(SALIDA, "nuevo-backlog.png") });
  await cap.setViewportSize({ width: 1366, height: 860 });
  await cap.getByRole("button", { name: "Registrar backlog" }).click();
  await esperarEstado(cap, "Identificado");
  const id = cap.url().split("/backlog/")[1];
  const folio = (await cap.locator(".ficha-folio").textContent()).match(/BL-HEM-\d{6}/)?.[0];
  if (!folio) throw new Error("La ficha no muestra el folio");
  await cap.getByRole("heading", { name: "PS011 · Sistema hidráulico · Block de implementos" }).waitFor();
  ok(`registro crea ${folio} con componente y abre la ficha`);
  // 018: el capturador es autónomo y ve las acciones del estado (aprobar, rechazar, anular).
  for (const accion of ["Aprobar y planificar", "Rechazar", "Anular"])
    await cap.locator(".ficha-acciones").getByRole("button", { name: accion, exact: true }).waitFor();
  await cap.getByRole("tab", { name: /^Repuestos/ }).click();
  for (const [parte] of REPUESTOS) await cap.getByRole("cell", { name: parte }).waitFor();
  await cap.getByRole("tab", { name: /^HH/ }).click();
  await cap.getByText("8", { exact: true }).first().waitFor();
  ok("4 repuestos y 8 HH grabados junto con el backlog; el capturador no ve botones de estado");

  // Fotos: 2 del registro (generales) y 1 del ítem 1 desde la tabla de repuestos.
  await cap.getByRole("tab", { name: /^Repuestos/ }).click();
  await cap.getByLabel("Fotos ítem 1").setInputFiles([FOTO("kit-cierres.png", [40, 140, 60])]);
  await aviso(cap, "1 foto(s) agregada(s)");
  await cap.getByRole("tab", { name: "Fotos (3)" }).click();
  const grupoItem1 = cap.locator(".grupo-fotos", { hasText: "Ítem 1 · 6060003007" });
  await grupoItem1.locator("img").waitFor();
  if ((await cap.locator(".grupo-fotos", { hasText: "Fotos generales" }).locator("img").count()) !== 2) throw new Error("Faltan las 2 fotos generales");
  await cap.waitForFunction(() => [...document.querySelectorAll(".rejilla-fotos img")].every((i) => i.complete && i.naturalWidth > 0));
  if (await cap.locator(".rejilla-fotos").getByRole("button", { name: "Borrar" }).count()) throw new Error("El capturador ve Borrar foto");
  await cap.screenshot({ path: join(SALIDA, "fotos.png") });
  ok("3 fotos (2 generales y 1 del ítem 1) se ven en la ficha; el capturador no puede borrar");

  // Un capturador de Veta Nueva no puede subir a un backlog de HEMCO (política de Storage).
  const unidadHem = (await (await fetch(`http://localhost:${PUERTO_REST}/rest/v1/v_backlog?select=unidad_id&id=eq.${id}`, {
    headers: { authorization: `Bearer ${token(USUARIOS.admin)}` },
  })).json())[0].unidad_id;
  const intruso = await fetch(`http://localhost:${PUERTO_REST}/storage/v1/object/backlog-fotos/${unidadHem}/${id}/intruso.jpg`, {
    method: "POST",
    headers: { authorization: `Bearer ${token(USUARIOS.capVtn)}`, "content-type": "image/jpeg" },
    body: png(10, 10, [0, 0, 0]),
  });
  const motivoIntruso = (await intruso.json()).message ?? "";
  if (intruso.status === 200 || !motivoIntruso.includes("row-level security"))
    throw new Error(`Storage debía rechazar por política la foto de otra unidad: ${intruso.status} ${motivoIntruso}`);
  ok("Storage rechaza la foto de un capturador de otra unidad");

  // Formato imprimible: en el navegador se abre en una ventana nueva.
  const [ventana] = await Promise.all([cap.context().waitForEvent("page"), cap.getByRole("button", { name: "Imprimir formato" }).click()]);
  await ventana.waitForFunction(() => document.title && !document.title.startsWith("Generando"));
  const htmlFormato = await ventana.content();
  for (const [parte, , , desc] of REPUESTOS) {
    if (!htmlFormato.includes(parte) || !htmlFormato.includes(desc.replace("(", "(")))
      throw new Error(`El formato no tiene el repuesto ${parte}`);
  }
  if (!htmlFormato.includes("data:image/png")) throw new Error("El formato no lleva el logo Dimelco incrustado");
  if (htmlFormato.includes("TMSA")) throw new Error("El formato tiene datos del cliente");
  if (htmlFormato.includes('alt="Explotec"')) throw new Error("Un backlog de HEMCO no lleva el logo de Explotec");
  if (!htmlFormato.includes("Reempaque de block de implementos")) throw new Error("Falta la descripción del trabajo");
  if (!/Xavier Araica<\/div><div class="linea">Reportado por/.test(htmlFormato) || !/Luis Mena<\/div><div class="linea">Aprobado por/.test(htmlFormato))
    throw new Error("Las firmas no llevan quién reporta y quién aprueba");
  await ventana.setViewportSize({ width: 900, height: 1270 });
  await ventana.screenshot({ path: join(SALIDA, "formato.png"), fullPage: true });
  if (!htmlFormato.includes("IMÁGENES") || !htmlFormato.includes("<b>Ítem 1</b> · N° de parte 6060003007"))
    throw new Error("El formato no trae la hoja 2 con la foto del ítem 1");
  if ((htmlFormato.match(/data:image\/jpeg/g) ?? []).length !== 3) throw new Error("El formato no incrusta las 3 fotos");
  await ventana.locator(".hoja2").screenshot({ path: join(SALIDA, "formato-imagenes.png") });
  await ventana.close();
  ok("el formato impreso tiene los 4 repuestos, el logo Dimelco y nada del cliente");

  // 2. El admin aprueba, agrega un repuesto y la base bloquea pasar a Listo con repuestos pendientes.
  const adm = await abrir("admin");
  await adm.goto(base + `#/backlog/${id}`);
  await esperarEstado(adm, "Identificado");
  await transicion(adm, "Aprobar y planificar", (d) => d.getByLabel("Prioridad confirmada").selectOption("P2"));
  await esperarEstado(adm, "En planificación");
  await adm.locator(".etiqueta-prioridad", { hasText: "2 Alto" }).waitFor();
  ok("admin aprueba con prioridad 2 Alto");
  await adm.getByRole("tab", { name: "Fotos (3)" }).click();
  await adm.locator(".grupo-fotos", { hasText: "Fotos generales" }).getByRole("button", { name: "Borrar" }).first().click();
  await adm.getByRole("dialog").getByRole("button", { name: "Borrar", exact: true }).click();
  await aviso(adm, "Foto borrada");
  await adm.getByRole("tab", { name: "Fotos (2)" }).waitFor();
  ok("el admin borra una foto y quedan 2");
  await adm.getByRole("tab", { name: /^Repuestos/ }).click();
  await adm.getByLabel("Código nuevo").fill("100234");
  await adm.getByLabel("Descripción nueva").fill("Aceite hidráulico ISO 68");
  await adm.getByRole("button", { name: "Agregar", exact: true }).click();
  await adm.getByLabel("Estado ítem 5").waitFor();
  ok("repuesto agregado en la ficha toma el ítem 5");
  // Los materiales ya agregados se editan en la ficha hasta Listo para programar.
  const cant5 = adm.getByLabel("Cantidad ítem 5");
  await cant5.fill("3");
  await cant5.blur();
  const desc5 = adm.getByLabel("Descripción ítem 5");
  await desc5.fill("Aceite hidráulico ISO 68 (tambor)");
  await desc5.blur();
  await adm.waitForFunction(() => document.querySelector('[aria-label="Descripción ítem 5"]')?.defaultValue === "Aceite hidráulico ISO 68 (tambor)");
  const rep5 = (await (await fetch(`http://localhost:${PUERTO_REST}/rest/v1/backlog_repuestos?select=cantidad,descripcion&backlog_id=eq.${id}&item=eq.5`, {
    headers: { authorization: `Bearer ${token(USUARIOS.admin)}` },
  })).json())[0];
  if (Number(rep5.cantidad) !== 3 || rep5.descripcion !== "Aceite hidráulico ISO 68 (tambor)") throw new Error(`Ítem 5 no se editó: ${JSON.stringify(rep5)}`);
  const anchoEstado = await adm.getByLabel("Estado ítem 5").evaluate((e) => e.scrollWidth <= e.clientWidth + 1 && e.clientWidth >= 100);
  if (!anchoEstado) throw new Error("La columna Estado del repuesto queda cortada");
  ok("los materiales ya agregados se editan en la ficha (cantidad y descripción) y la columna Estado se ve completa");
  await transicion(adm, "Listo para programar");
  await aviso(adm, "Faltan 5 repuesto");
  await adm.getByRole("dialog").getByRole("button", { name: "Cancelar" }).click();
  ok("la base rechaza «Listo para programar» con repuestos sin recibir y la app muestra el motivo");
  await transicion(adm, "Pasar a esperar repuestos");
  await esperarEstado(adm, "Esperando repuestos");
  await adm.getByLabel("Solicitud ítem 1").fill("10045678");
  await adm.getByLabel("Solicitud ítem 1").blur();
  for (let i = 1; i <= 5; i++) {
    await adm.getByLabel(`Estado ítem ${i}`).selectOption("Recibido");
    await adm.locator("tr.fila-recibida").nth(i - 1).waitFor();
  }
  await esperarEstado(adm, "Listo para programar");
  ok("al recibir el último de los 5 repuestos pasa solo a «Listo para programar»");

  // 3. Kanban: la tarjeta se despliega con repuestos, especialidades y HH; se programa arrastrándola.
  await adm.goto(base + "#/kanban");
  const tarjeta = adm.getByRole("article", { name: `${folio} PS011` });
  await adm.locator('section[aria-label="Planeado"]').getByRole("article", { name: `${folio} PS011` }).waitFor();
  const nombresColumnas = await adm.locator(".columna-cabecera > span:first-child").allTextContents();
  if (nombresColumnas.join("|") !== "1. Identificado|2. Planeado|3. Programado|4. Ejecutado|5. Validado (7 días)")
    throw new Error(`Columnas del Kanban: ${nombresColumnas.join(" | ")}`);
  await tarjeta.getByLabel("Avance: paso 2 de 5, Planeado").waitFor();
  await tarjeta.locator(".tk-subestado", { hasText: "Listo para programar" }).waitFor();
  ok("Kanban con 5 etapas; la tarjeta muestra la barra 2 de 5 y el subestado «Listo para programar»");
  await tarjeta.locator(".tk-cabecera").click();
  await tarjeta.locator(".tk-detalle .barra-avance.detallada li.actual", { hasText: "Planeado" }).waitFor();
  for (const texto of ["6060003007", "Juego de cierres EOD", "Mecánico", "2 × 4 = 8", "Fugas de aceite en el block"]) {
    await tarjeta.locator(".tk-detalle", { hasText: texto }).waitFor();
  }
  ok("la tarjeta del Kanban se despliega con repuestos, especialidades × horas y justificación");
  if (await adm.locator(`section[aria-label="Planeado"] .tarjeta-kanban`, { hasText: "PS090" }).count())
    throw new Error("Kanban mezcla unidades con filtro de unidad");
  await adm.locator(".kanban").evaluate((k) => (k.scrollLeft = 0));
  await adm.screenshot({ path: join(SALIDA, "kanban.png") });
  await tarjeta.locator(".tk-cabecera").click(); // se cierra
  // Arrastre en Kanban: JU005 (Identificado, con HH) a «Planeado» = aprobar y planificar.
  const ju005 = adm.getByRole("article", { name: "BL-HEM-000004 JU005" });
  await ju005.dragTo(adm.locator('section[aria-label="Planeado"] .columna-cabecera'), { sourcePosition: { x: 40, y: 12 } });
  const dlgK = adm.getByRole("dialog");
  await dlgK.waitFor();
  await dlgK.getByRole("button", { name: "Aprobar y planificar", exact: true }).click();
  const ju005Planeado = adm.locator('section[aria-label="Planeado"]').getByRole("article", { name: "BL-HEM-000004 JU005" });
  await ju005Planeado.locator(".tk-subestado", { hasText: "En planificación" }).waitFor();
  ok("arrastrar una tarjeta en el Kanban abre el diálogo de la transición y la mueve de columna");

  // 3b. Capacidad: el capturador carga Mecánico de HEMCO con la calculadora (2 personas × 10 h × 2 turnos = 40 HH).
  await cap.goto(base + "#/capacidad");
  await cap.getByRole("link", { name: "Capacidad del taller" }).waitFor();
  await cap.getByRole("button", { name: "Cambiar Mecánico HEMCO" }).click();
  await cap.getByLabel("Personas Mecánico").fill("2");
  await cap.getByLabel("Horas por turno Mecánico").fill("10");
  await cap.getByLabel("Turnos Mecánico").fill("2");
  if ((await cap.getByLabel("HH por semana Mecánico").inputValue()) !== "40") throw new Error("La calculadora no da 40 HH");
  await cap.getByRole("button", { name: "Grabar" }).click();
  await aviso(cap, "Capacidad grabada");
  await cap.locator("section", { has: cap.getByRole("heading", { name: "HEMCO" }) }).getByRole("row", { name: /Mecánico 40/ }).waitFor();
  await cap.screenshot({ path: join(SALIDA, "capacidad.png"), fullPage: true });
  ok("el capturador carga la capacidad de Mecánico de su unidad con la calculadora: 40 HH por semana");

  // 3c. Calendario: arrastrar el backlog listo a mañana, completar la OT y reprogramarlo.
  const lunesIso = (iso) => {
    const d = new Date(iso + "T00:00:00");
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  };
  const ddmm = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
  const manana = enDias(1);
  await adm.goto(base + "#/calendario");
  await adm.getByRole("heading", { name: "Calendario" }).waitFor();
  if (lunesIso(manana) !== lunesIso(enDias(0))) await adm.getByRole("button", { name: "Semana siguiente" }).click();
  const listo = adm.getByRole("complementary", { name: "Listos para programar" }).getByLabel(`${folio} PS011`);
  await listo.dragTo(adm.getByRole("columnheader", { name: `Día ${ddmm(manana)}` }));
  const dlgC = adm.getByRole("dialog");
  await dlgC.waitFor();
  if ((await dlgC.getByLabel("Fecha programada").inputValue()) !== manana) throw new Error("El diálogo no trae la fecha del día soltado");
  await dlgC.getByLabel("OT SAP").fill("4001234");
  await dlgC.getByLabel("Aprovechar la parada de un PM").check();
  await dlgC.getByRole("button", { name: "Programar", exact: true }).click();
  const enGrilla = adm.locator(".grilla-semana").getByLabel(`${folio} PS011`);
  await enGrilla.waitFor();
  // Mecánico de la semana: JU005 (2 × 4) + PS011 (2 × 4) = 16 de 40 HH.
  await adm.getByLabel("Carga Mecánico").filter({ hasText: "16 / 40 HH · 40 %" }).waitFor();
  ok("arrastrar al calendario programa con la fecha del día y la barra muestra 16 de 40 HH de Mecánico");
  const otroDia = lunesIso(enDias(2)) === lunesIso(manana) ? enDias(2) : enDias(0);
  await enGrilla.dragTo(adm.getByRole("columnheader", { name: `Día ${ddmm(otroDia)}` }));
  const dlgR = adm.getByRole("dialog");
  await dlgR.waitFor();
  if ((await dlgR.getByLabel("Fecha programada").inputValue()) !== otroDia) throw new Error("Reprogramar no trae la fecha nueva");
  await dlgR.getByLabel("Motivo").fill("Equipo en producción, sin parada ese día");
  await dlgR.getByRole("button", { name: "Reprogramar", exact: true }).click();
  await aviso(adm, `reprogramado al ${ddmm(otroDia)}`);
  await adm.screenshot({ path: join(SALIDA, "calendario.png") });
  ok("arrastrar un programado a otro día lo reprograma con motivo y misma OT");

  // Sin tiempo real en la prueba: se recarga para no ver la caché (15 s) del capturador.
  await cap.goto(base + "#/calendario");
  await cap.reload();
  await cap.getByRole("heading", { name: "Calendario" }).waitFor();
  if (lunesIso(otroDia) !== lunesIso(enDias(0))) await cap.getByRole("button", { name: "Semana siguiente" }).click();
  await cap.locator(".grilla-semana").getByLabel(`${folio} PS011`).waitFor();
  if (!(await cap.locator('.pagina-calendario [draggable="true"]').count())) throw new Error("El capturador no puede arrastrar en el calendario");
  ok("el capturador ve el calendario y también puede arrastrar para programar");

  // 3d. Indicadores (todas las unidades). Cálculo a mano en este punto del recorrido:
  //   Mecánico 12 + 6 + 8 + 8 = 34 HH / 40 = 0,85 · Hidráulico 6 / 10 = 0,6 · Eléctrico 2 / 20 = 0,1
  //   Total 42 / 70 = 0,6 semanas · 6 abiertos · 1 vencido · programadas 16 / 42 = 38 %
  await adm.goto(base + "#/indicadores");
  await adm.reload();
  await adm.getByRole("heading", { name: "Indicadores" }).waitFor();
  const tile = (etiqueta) => adm.locator(".tile", { has: adm.locator(".tile-etiqueta", { hasText: etiqueta }) }).locator(".tile-valor");
  const esperado = { "Backlogs abiertos": "6", "HH acumuladas pendientes": "42", "Semanas de backlog": "0.6", Vencidos: "1", "HH pendientes ya programadas": "38 %" };
  for (const [et, v] of Object.entries(esperado)) {
    const real = await tile(et).textContent();
    if (real !== v) throw new Error(`Indicador «${et}»: esperado ${v}, obtenido ${real}`);
  }
  const barra = (esp) => adm.locator(".bh-fila", { hasText: esp }).first().locator(".bh-valor").textContent();
  for (const [esp, v] of [["Mecánico", "34 HH"], ["Hidráulico", "6 HH"], ["Eléctrico", "2 HH"]]) {
    if ((await barra(esp)) !== v) throw new Error(`HH acumuladas ${esp}: esperado ${v}, obtenido ${await barra(esp)}`);
  }
  if ((await adm.locator(".bh-fila", { hasText: "0-15 días" }).locator(".bh-valor").textContent()) !== "5 · 36 HH")
    throw new Error("Antigüedad 0-15 días no da 5 backlogs y 36 HH");
  await adm.screenshot({ path: join(SALIDA, "indicadores.png"), fullPage: true });
  ok("indicadores: 42 HH acumuladas (Mecánico 34), 0,6 semanas, 6 abiertos, 1 vencido, 38 % programado");

  const [rep] = await Promise.all([adm.context().waitForEvent("page"), adm.getByRole("button", { name: "Reporte semanal PDF" }).click()]);
  await rep.waitForFunction(() => document.title && !document.title.startsWith("Generando"));
  const htmlRep = await rep.content();
  for (const t of ["Reporte semanal de backlog", "Vencidos (1)", "BL-HEM-000001", "Programados para los próximos 7 días (2)", folio, "data:image/png"]) {
    if (!htmlRep.includes(t)) throw new Error(`El reporte no tiene «${t}»`);
  }
  await rep.setViewportSize({ width: 1270, height: 900 });
  await rep.screenshot({ path: join(SALIDA, "reporte-semanal.png"), fullPage: true });
  await rep.close();
  ok("reporte semanal con indicadores, vencidos y programados de los próximos 7 días");

  const [descarga] = await Promise.all([adm.waitForEvent("download"), adm.getByRole("button", { name: "Exportar a Excel" }).click()]);
  const rutaXlsx = join(SALIDA, "backlog-abierto.xlsx");
  await descarga.saveAs(rutaXlsx);
  const ExcelJS = require("exceljs");
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.readFile(rutaXlsx);
  const hojaAb = libro.getWorksheet("Backlogs abiertos");
  if (hojaAb.rowCount !== 7) throw new Error(`El Excel debía tener 6 abiertos, tiene ${hojaAb.rowCount - 1}`);
  const mec = libro.getWorksheet("Semanas de backlog").getRows(2, 10).find((r) => r.getCell(1).value === "Mecánico");
  if (Math.abs(mec.getCell(4).value - 0.85) > 1e-9) throw new Error("Excel: semanas de Mecánico distinto de 0,85");
  const hojasXlsx = libro.worksheets.map((h) => h.name).join(" | ");
  if (hojasXlsx !== "Backlogs abiertos | Repuestos de abiertos | Cerrados últimos 7 días | Ejecutados y validados | Rep. ejecutados y validados | Semanas de backlog | Preventivos | Materiales de preventivos") throw new Error(`Hojas del Excel: ${hojasXlsx}`);
  const repAb = libro.getWorksheet("Repuestos de abiertos");
  const filaParte = repAb.getRows(2, repAb.rowCount - 1).find((r) => r.values.includes("6060003007"));
  if (!filaParte || !filaParte.values.includes("Reempaque de block de implementos por fugas de aceite"))
    throw new Error("Repuestos de abiertos sin el número de parte 6060003007 con su actividad");
  if (repAb.rowCount - 1 !== 7) throw new Error(`Repuestos de abiertos: esperadas 7 líneas (5 del registro y 2 de la semilla), hay ${repAb.rowCount - 1}`);
  ok("Excel con 6 backlogs abiertos, sus 7 repuestos con la actividad, ejecutados y validados, y semanas de backlog");

  // Vista por equipo: el capturador ve PS011 en la flota Scoop con su backlog abierto, y no ve Veta Nueva.
  await cap.goto(base + "#/flota");
  const ps011 = cap.getByRole("article", { name: "PS011" });
  await ps011.waitFor();
  if (await cap.getByRole("article", { name: "PS090" }).count()) throw new Error("La vista por equipo muestra equipos de otra unidad");
  await ps011.locator(".te-cabecera").click();
  await ps011.getByRole("link", { name: folio }).waitFor();
  await cap.screenshot({ path: join(SALIDA, "por-equipo.png"), fullPage: true });
  await ps011.getByRole("link", { name: "Historial del equipo" }).click();
  await cap.getByRole("heading", { name: "PS011" }).waitFor();
  await cap.getByRole("cell", { name: "Sistema hidráulico" }).first().waitFor();
  ok("vista por equipo agrupa por flota, despliega los backlogs y abre el historial del equipo");
  await cap.goto(base + `#/backlog/${id}`);
  await cap.reload();

  // 4. El capturador carga HH reales y marca ejecutado.
  await esperarEstado(cap, "Programado");
  await cap.getByRole("tab", { name: /^HH/ }).click();
  const reales = cap.locator(".bloque-ficha", { has: cap.getByRole("heading", { name: "HH reales" }) });
  await reales.getByLabel("Especialidad nueva").selectOption({ label: "Mecánico" });
  await reales.getByLabel("Personas nuevas").fill("2");
  await reales.getByLabel("Horas nuevas").fill("5");
  await reales.getByRole("button", { name: "Agregar" }).click();
  await reales.getByText("10", { exact: true }).first().waitFor();
  await cap.getByRole("tab", { name: /^Repuestos/ }).click();
  await cap.locator(".bloque-ficha .nota", { hasText: "los materiales no se editan" }).waitFor();
  if (await cap.getByLabel("Número de parte ítem 1").count()) throw new Error("Materiales editables con el backlog Programado");
  await cap.getByRole("tab", { name: /^HH/ }).click();
  await cap.locator(".ficha-acciones").getByRole("button", { name: "Reprogramar", exact: true }).waitFor();
  await cap.locator(".ficha-acciones").getByRole("button", { name: "Quitar del calendario", exact: true }).waitFor();
  await transicion(cap, "Marcar ejecutado", (d) => d.getByLabel(/Comentario/).fill("Se cambiaron sellos y se probó el levante"));
  await esperarEstado(cap, "Ejecutado");
  ok("capturador carga 10 HH reales y marca ejecutado");

  // 5. El capturador valida; el backlog queda bloqueado para él y solo el admin lo revierte o lo borra.
  await transicion(cap, "Validar");
  await esperarEstado(cap, "Validado");
  await cap.getByLabel("Avance: paso 5 de 5, Validado").waitFor();
  if (await cap.locator(".ficha-acciones button", { hasNotText: "Imprimir formato" }).count())
    throw new Error("El capturador conserva acciones en un backlog validado");
  await adm.goto(base + `#/backlog/${id}`);
  await adm.reload();
  await esperarEstado(adm, "Validado");
  for (const accion of ["Revertir a ejecutado", "Borrar"])
    await adm.locator(".ficha-acciones").getByRole("button", { name: accion, exact: true }).waitFor();
  if (await adm.locator(".ficha-acciones button", { hasNotText: /Imprimir formato|^Borrar$|^Revertir a ejecutado$/ }).count())
    throw new Error("Quedan otras acciones en un backlog validado");
  await adm.getByRole("tab", { name: "Datos" }).click();
  if (!(await adm.locator("label.campo", { hasText: "Descripción del trabajo" }).locator("input").isDisabled()))
    throw new Error("Datos editables en un backlog cerrado");
  const deteccion = await adm.locator("label.campo", { hasText: "Fecha de detección" }).locator("input").inputValue();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(deteccion)) throw new Error(`Fecha de detección vacía o mal formada: «${deteccion}»`);
  ok("el capturador valida (paso 5 de 5); para él queda sin acciones y el admin puede revertir o borrar");

  // El Excel trae los repuestos del backlog validado en su hoja.
  await adm.goto(base + "#/indicadores");
  await adm.reload();
  await adm.getByRole("heading", { name: "Indicadores" }).waitFor();
  const [descarga2] = await Promise.all([adm.waitForEvent("download"), adm.getByRole("button", { name: "Exportar a Excel" }).click()]);
  const rutaXlsx2 = join(SALIDA, "backlog-con-validado.xlsx");
  await descarga2.saveAs(rutaXlsx2);
  const libro2 = new (require("exceljs").Workbook)();
  await libro2.xlsx.readFile(rutaXlsx2);
  const repEj = libro2.getWorksheet("Rep. ejecutados y validados");
  const lineasEj = repEj.getRows(2, Math.max(1, repEj.rowCount - 1)) ?? [];
  if (lineasEj.length !== 5 || !lineasEj.every((r) => r.values.includes(folio) && r.values.includes("Validado")))
    throw new Error(`Rep. ejecutados y validados: esperadas 5 líneas del ${folio} Validado, hay ${lineasEj.length}`);
  if (!libro2.getWorksheet("Ejecutados y validados").getRows(2, 1)?.[0]?.values.includes(folio)) throw new Error("Falta el validado en Ejecutados y validados");
  await adm.goto(base + `#/backlog/${id}`);
  ok("el Excel trae el backlog validado y sus 5 números de parte en las hojas de ejecutados y validados");

  await adm.getByRole("tab", { name: /^Bitácora/ }).click();
  const eventos = await adm.locator(".bitacora .evento").count();
  if (eventos !== 8) throw new Error(`La bitácora debía tener 8 eventos, tiene ${eventos}`);
  await adm.locator(".evento-texto", { hasText: "Equipo en producción, sin parada ese día" }).waitFor();
  await adm.locator(".evento-texto", { hasText: "Automático: todos los repuestos recibidos" }).waitFor();
  ok("bitácora con 8 eventos, incluidos el paso automático y la reprogramación");
  await adm.screenshot({ path: join(SALIDA, "ficha-bitacora.png"), fullPage: true });
  await adm.getByRole("tab", { name: "Datos" }).click();
  await adm.screenshot({ path: join(SALIDA, "ficha-datos.png"), fullPage: true });

  // 7. Administración: equipos, sistemas y especialidades, plazos.
  await adm.goto(base + "#/equipos");
  await adm.getByRole("heading", { name: "Equipos" }).waitFor();
  const nuevoEq = adm.locator(".panel-formulario");
  await nuevoEq.getByLabel("Unidad").selectOption({ label: "HEMCO" });
  await nuevoEq.getByLabel("Código interno").fill("PS013");
  await nuevoEq.getByLabel("Familia").selectOption({ label: "Scooptram ST1030" });
  await nuevoEq.getByLabel("Marca").fill("Epiroc");
  await nuevoEq.getByLabel("Modelo").fill("ST14");
  await nuevoEq.getByRole("button", { name: "Crear" }).click();
  await aviso(adm, "Equipo PS013 creado");
  await nuevoEq.getByLabel("Código interno").fill("PS013");
  await nuevoEq.getByLabel("Modelo").fill("ST14");
  await nuevoEq.getByRole("button", { name: "Crear" }).click();
  await aviso(adm, "Ya existe un equipo con ese código interno en la unidad");
  await adm.screenshot({ path: join(SALIDA, "equipos.png") });
  await adm.goto(base + "#/nuevo");
  await adm.getByLabel("Equipo", { exact: true }).locator("optgroup[label='Scooptram ST1030'] option", { hasText: "PS013" }).waitFor({ state: "attached" });
  await adm.goto(base + "#/equipos");
  await adm.getByLabel("Activo PS013").click();
  await adm.getByLabel("Activo PS013").waitFor({ state: "detached" }); // sin «Mostrar inactivos» sale de la lista
  await adm.goto(base + "#/nuevo");
  await adm.reload();
  await adm.getByLabel("Equipo", { exact: true }).locator("option", { hasText: "PS011" }).first().waitFor({ state: "attached" });
  if (await adm.getByLabel("Equipo", { exact: true }).locator("option", { hasText: "PS013" }).count())
    throw new Error("Un equipo inactivo sigue apareciendo al registrar");
  ok("equipo PS013 creado (código repetido rechazado), aparece al registrar y al desactivarlo deja de aparecer");

  await adm.goto(base + "#/catalogos");
  const esp = adm.getByRole("region", { name: "Especialidades" });
  await esp.getByLabel("Nuevo en Especialidades").fill("Lubricador");
  await esp.getByRole("button", { name: "Agregar" }).click();
  await esp.getByLabel("Nombre Lubricador").waitFor();
  await esp.getByLabel("Activo Llantero").click();
  await esp.locator("tr.fila-inactiva", { has: adm.getByLabel("Nombre Llantero") }).waitFor();
  await adm.goto(base + "#/capacidad");
  await adm.reload();
  await adm.getByRole("button", { name: "Cambiar Lubricador HEMCO" }).waitFor();
  if (await adm.getByRole("button", { name: "Cambiar Llantero HEMCO" }).count()) throw new Error("Especialidad inactiva en capacidad");
  ok("especialidad Lubricador agregada y Llantero desactivada (sale de Capacidad)");

  await adm.goto(base + "#/plazos");
  await adm.waitForFunction(() => document.querySelector('[aria-label="Plazo P4"]')?.value === "40");
  await adm.getByLabel("Plazo P4").fill("10");
  await adm.getByLabel("Plazo P4").blur();
  await aviso(adm, "Plazo grabado");
  await adm.getByRole("button", { name: "Recalcular abiertos" }).click();
  await adm.getByRole("dialog").getByRole("button", { name: "Recalcular" }).click();
  await aviso(adm, "1 backlog(s) abiertos con fecha límite nueva");
  ok("plazo P4 a 10 días y recálculo de 1 backlog abierto");

  // SAP solo en HEMCO: Veta Nueva no ve Aviso SAP ni Código SAP y su OT se llama N° OT.
  const vtn = await abrir("capVtn");
  await vtn.goto(base + "#/nuevo");
  await vtn.getByLabel("Equipo", { exact: true }).selectOption({ label: "PS090 · ST7" });
  await vtn.getByRole("button", { name: "Agregar repuesto" }).click();
  await vtn.getByLabel("Número de parte ítem 1").waitFor();
  if (await vtn.getByLabel("Aviso SAP (si existe)").count()) throw new Error("Veta Nueva ve Aviso SAP");
  await vtn.getByLabel("Código ítem 1").waitFor();
  await vtn.getByRole("columnheader", { name: "Cód. interno" }).waitFor();
  if (await vtn.getByRole("columnheader", { name: "Código SAP" }).count()) throw new Error("Veta Nueva ve la columna Código SAP");
  ok("Veta Nueva registra sin Aviso SAP; el código del repuesto se llama Cód. interno");

  // Borrar: el capturador borra un backlog con motivo; el admin lo ve en Borrados y lo restaura.
  await cap.goto(base + "#/backlog/30000000-0000-0000-0000-000000000001");
  await cap.reload();
  const folioBorrar = (await cap.locator(".ficha-folio").textContent()).match(/BL-HEM-\d{6}/)[0];
  await cap.getByRole("button", { name: "Borrar", exact: true }).click();
  const dlgB = cap.getByRole("dialog");
  if (!(await dlgB.getByRole("button", { name: "Borrar" }).isDisabled())) throw new Error("Deja borrar sin motivo");
  await dlgB.getByLabel("Motivo del borrado").fill("Registrado dos veces");
  await dlgB.getByRole("button", { name: "Borrar" }).click();
  await aviso(cap, `${folioBorrar} borrado`);
  await cap.waitForURL(/#\/flota/);
  await cap.goto(base + "#/kanban");
  await cap.locator(".tarjeta-kanban").first().waitFor();
  if (await cap.locator(".tarjeta-kanban", { hasText: folioBorrar }).count()) throw new Error("El borrado sigue en el Kanban");
  ok(`el capturador borra ${folioBorrar} con motivo y sale del Kanban`);
  await adm.goto(base + "#/borrados");
  await adm.reload();
  const filaB = adm.getByRole("row", { name: new RegExp(folioBorrar) });
  await filaB.getByRole("cell", { name: "Registrado dos veces" }).waitFor();
  await filaB.getByRole("cell", { name: "Carlos Capturador" }).waitFor();
  await adm.screenshot({ path: join(SALIDA, "borrados.png"), fullPage: true });
  await adm.getByRole("button", { name: `Restaurar ${folioBorrar}` }).click();
  await adm.getByRole("dialog").getByRole("button", { name: "Restaurar" }).click();
  await aviso(adm, `${folioBorrar} restaurado`);
  await adm.getByText("No hay backlogs borrados.").waitFor();
  await adm.goto(base + "#/backlog/30000000-0000-0000-0000-000000000001");
  await adm.getByRole("tab", { name: /^Bitácora/ }).click();
  await adm.locator(".evento-texto", { hasText: "Borrado: Registrado dos veces" }).waitFor();
  await adm.locator(".evento-texto", { hasText: "Restaurado" }).waitFor();
  ok("el admin ve el motivo y quién lo borró, lo restaura y la bitácora lo registra");

  // Usuarios: invitado con dos unidades al crearlo; luego se agrega Explotec y se quita Veta Nueva.
  await adm.goto(base + "#/usuarios");
  await adm.reload();
  await adm.getByRole("heading", { name: "Usuarios" }).waitFor();
  await adm.getByLabel("Nuevo usuario: nombre").fill("Invitado multi");
  await adm.getByLabel("Correo (usuario de acceso)").fill("invitado.multi@prueba.com");
  await adm.getByLabel("Rol").first().selectOption("invitado");
  if (!(await adm.getByRole("button", { name: "Crear usuario" }).isDisabled())) throw new Error("Deja crear sin unidades");
  await adm.getByLabel("HEMCO usuario nuevo").check();
  await adm.getByLabel("Veta Nueva usuario nuevo").check();
  await adm.getByLabel("Contraseña inicial").fill("ClaveSegura1");
  await adm.getByRole("button", { name: "Crear usuario" }).click();
  await aviso(adm, "Usuario Invitado multi creado");
  const casillas = adm.getByRole("group", { name: "Unidades de Invitado multi" });
  await casillas.getByLabel("Veta Nueva Invitado multi").waitFor();
  await adm.waitForFunction(() => {
    const g = document.querySelector('[aria-label="Unidades de Invitado multi"]');
    return g && [...g.querySelectorAll("input")].filter((i) => i.checked).length === 2;
  });
  await casillas.getByLabel("Explotec Invitado multi").click();
  await adm.waitForFunction(() => [...document.querySelectorAll('[aria-label="Unidades de Invitado multi"] input')].filter((i) => i.checked).length === 3);
  await casillas.getByLabel("Veta Nueva Invitado multi").click();
  await adm.waitForFunction(() => [...document.querySelectorAll('[aria-label="Unidades de Invitado multi"] input')].filter((i) => i.checked).length === 2);
  const unidadesBd = (await (await fetch(`http://localhost:${PUERTO_REST}/rest/v1/perfiles?select=unidades&correo=eq.invitado.multi@prueba.com`, {
    headers: { authorization: `Bearer ${token(USUARIOS.admin)}` },
  })).json())[0].unidades.length;
  if (unidadesBd !== 2) throw new Error(`El invitado debía quedar con 2 unidades, tiene ${unidadesBd}`);
  await adm.screenshot({ path: join(SALIDA, "usuarios.png"), fullPage: true });
  ok("usuario creado con dos unidades marcadas; se agrega Explotec y se quita Veta Nueva en la tabla");

  // Capturador con dos unidades: elige entre sus unidades y registra en cualquiera de ellas.
  const pedir = (ruta, opciones = {}) =>
    fetch(`http://localhost:${PUERTO_REST}/rest/v1/${ruta}`, {
      ...opciones,
      headers: { authorization: `Bearer ${token(USUARIOS.admin)}`, "content-type": "application/json", ...(opciones.headers ?? {}) },
    });
  const uni = Object.fromEntries((await (await pedir("unidades?select=id,sigla")).json()).map((u) => [u.sigla, u.id]));
  const ponerUnidades = async (lista) => {
    const r = await pedir(`perfiles?user_id=eq.${USUARIOS.cap.id}`, { method: "PATCH", body: JSON.stringify({ unidades: lista }) });
    if (!r.ok) throw new Error(`No se pudieron cambiar las unidades del capturador: ${r.status} ${await r.text()}`);
  };
  await ponerUnidades([uni.HEM, uni.VTN]);
  const cap2 = await abrir("cap");
  await cap2.goto(base + "#/nuevo");
  const selector = cap2.locator(".selector-unidad select");
  await selector.waitFor();
  await cap2.waitForFunction(() => document.querySelectorAll(".selector-unidad select option").length > 1);
  const opcionesUnidad = await selector.locator("option").allTextContents();
  if (opcionesUnidad.join("|") !== "Todas mis unidades|HEMCO|Veta Nueva")
    throw new Error(`Selector de unidad del capturador: ${opcionesUnidad.join("|")}`);
  const equipoCap2 = cap2.getByLabel("Equipo", { exact: true });
  await equipoCap2.locator("option", { hasText: "PS090 · ST7 · Veta Nueva" }).waitFor({ state: "attached" });
  await equipoCap2.locator("option", { hasText: "PS011 · ST1030 · HEMCO" }).waitFor({ state: "attached" });
  await selector.selectOption({ label: "HEMCO" });
  await cap2.waitForFunction(() => ![...document.querySelectorAll('select[aria-label="Equipo"] option')].some((o) => o.textContent.includes("PS090")));
  await cap2.screenshot({ path: join(SALIDA, "capturador-dos-unidades.png") });
  await cap2.context().close();
  await ponerUnidades([uni.HEM]);
  ok("capturador con HEMCO y Veta Nueva: el selector ofrece Todas mis unidades, ve equipos de las dos y filtra por unidad");

  // Programar desde el Kanban con fecha pasada (019): se admite desde la fecha de detección.
  // BL-HEM-000004 (JU005, luminaria) se detectó ayer y está En planificación sin repuestos.
  const capK = await abrir("cap");
  await capK.goto(base + "#/backlog/30000000-0000-0000-0000-000000000003");
  await esperarEstado(capK, "En planificación");
  await transicion(capK, "Listo para programar");
  await esperarEstado(capK, "Listo para programar");
  await capK.goto(base + "#/kanban");
  const lum = capK.getByRole("article", { name: "BL-HEM-000004 JU005" });
  await lum.waitFor();
  await lum.dragTo(capK.locator('section[aria-label="Programado"] .columna-cabecera'), { sourcePosition: { x: 40, y: 12 } });
  const dlgP = capK.getByRole("dialog");
  await dlgP.waitFor();
  await dlgP.getByLabel("Fecha programada").fill(enDias(-2));
  await dlgP.getByLabel("OT SAP").fill("4002550");
  await dlgP.locator(".nota", { hasText: "fecha programada desde el" }).waitFor();
  if (!(await dlgP.getByRole("button", { name: "Programar", exact: true }).isDisabled())) throw new Error("Deja programar antes de la detección");
  await dlgP.getByLabel("Fecha programada").fill(enDias(-1));
  await dlgP.locator(".nota", { hasText: "programación pasada" }).waitFor();
  await capK.screenshot({ path: join(SALIDA, "programar-fecha-pasada.png") });
  await dlgP.getByRole("button", { name: "Programar", exact: true }).click();
  await capK.locator('section[aria-label="Programado"]').getByRole("article", { name: "BL-HEM-000004 JU005" }).waitFor();
  const prog = (await (await fetch(`http://localhost:${PUERTO_REST}/rest/v1/backlogs?select=fecha_programada&id=eq.30000000-0000-0000-0000-000000000003`, {
    headers: { authorization: `Bearer ${token(USUARIOS.admin)}` },
  })).json())[0].fecha_programada;
  if (prog !== enDias(-1)) throw new Error(`Fecha programada ${prog}, esperada ${enDias(-1)}`);
  await capK.context().close();
  ok("desde el Kanban se programa ayer (fecha de detección); antes de la detección no deja");

  // 7. Preventivos programados a mano (021). Veta Nueva no usa SAP: la app numera la OT.
  const pedirComo = (quien, ruta, opciones = {}) =>
    fetch(`http://localhost:${PUERTO_REST}/rest/v1/${ruta}`, {
      ...opciones,
      headers: { authorization: `Bearer ${token(USUARIOS[quien])}`, "content-type": "application/json", ...(opciones.headers ?? {}) },
    });
  const pv = await abrir("capVtn");
  await pv.goto(base + "#/preventivos");
  await pv.getByRole("heading", { name: "Preventivos", exact: true }).waitFor();
  await pv.getByRole("button", { name: "Programar preventivo" }).click();
  const dPm = pv.getByRole("dialog");
  await dPm.getByLabel("Equipo del preventivo").selectOption({ label: "PS090 · ST7" });
  if (await dPm.getByText("OT SAP").count()) throw new Error("Veta Nueva ve OT SAP al programar un preventivo");
  await dPm.locator(".nota", { hasText: "Falta: actividad" }).waitFor();
  await dPm.getByLabel("Actividad del preventivo").fill("PM 250 h motor diésel");
  await dPm.getByLabel("Horómetro programado").fill("1250");
  if ((await dPm.getByLabel("Fecha programada del preventivo").inputValue()) !== enDias(0)) throw new Error("El preventivo no propone la fecha de hoy");
  await dPm.getByRole("button", { name: "Programar", exact: true }).click();
  await aviso(pv, "PM-VTN-000001 programado · OT OT-VTN-000001");
  const filaPm = pv.locator(".tabla-preventivos tbody tr", { hasText: "PM-VTN-000001" });
  await filaPm.locator("td", { hasText: "OT-VTN-000001" }).waitFor();
  await pv.screenshot({ path: join(SALIDA, "preventivos.png") });
  ok("Veta Nueva programa un preventivo sin escribir OT: folio PM-VTN-000001 y OT-VTN-000001 automáticos");

  // Calendario: tarjeta PM en la celda del equipo; arrastrarla a otro día pide motivo.
  await pv.goto(base + "#/calendario");
  const tarjetaPm = pv.locator(".grilla-semana").getByLabel("PM-VTN-000001 PS090");
  await tarjetaPm.waitFor();
  if (!(await tarjetaPm.locator(".etiqueta-pm").count())) throw new Error("La tarjeta del preventivo no lleva la etiqueta PM");
  const diaPm = lunesIso(enDias(1)) === lunesIso(enDias(0)) ? enDias(1) : enDias(-1);
  await tarjetaPm.dragTo(pv.getByRole("columnheader", { name: `Día ${ddmm(diaPm)}` }));
  const dRe = pv.getByRole("dialog");
  await dRe.waitFor();
  if ((await dRe.getByLabel("Nueva fecha programada").inputValue()) !== diaPm) throw new Error("Reprogramar el preventivo no trae la fecha del día soltado");
  if (!(await dRe.getByRole("button", { name: "Reprogramar", exact: true }).isDisabled())) throw new Error("Deja reprogramar el preventivo sin motivo");
  await dRe.getByLabel("Motivo").fill("Equipo en producción");
  await dRe.getByRole("button", { name: "Reprogramar", exact: true }).click();
  await aviso(pv, `PM-VTN-000001: reprogramado al ${ddmm(diaPm)}`);
  // Desde la celda: "+ PM" abre el cuadro con el equipo y el día puestos.
  await pv.getByRole("button", { name: `Programar preventivo PS090 ${ddmm(diaPm)}` }).click({ force: true });
  const dCelda = pv.getByRole("dialog");
  if ((await dCelda.getByLabel("Fecha programada del preventivo").inputValue()) !== diaPm) throw new Error("+ PM no trae el día de la celda");
  if ((await dCelda.getByLabel("Equipo del preventivo").locator("option:checked").textContent()) !== "PS090 · ST7") throw new Error("+ PM no trae el equipo de la fila");
  await dCelda.getByRole("button", { name: "Cancelar" }).click();
  await pv.screenshot({ path: join(SALIDA, "calendario-preventivo.png") });
  ok("el preventivo sale en el calendario con la etiqueta PM, se reprograma arrastrando con motivo y «+ PM» propone equipo y día");

  // Un correctivo de Veta Nueva programado sin OT toma el número siguiente y sale «con PM».
  const blVtn = "30000000-0000-0000-0000-000000000005";
  const espMec = (await (await pedirComo("admin", "especialidades?select=id&nombre=eq.Mecánico")).json())[0].id;
  let rr = await pedirComo("capVtn", "backlog_hh", { method: "POST", body: JSON.stringify({ backlog_id: blVtn, especialidad_id: espMec, tipo: "estimada", personas: 1, horas: 3 }) });
  if (!rr.ok) throw new Error(`HH del backlog de Veta Nueva: ${rr.status} ${await rr.text()}`);
  for (const estado of ["En planificación", "Listo para programar"]) {
    rr = await pedirComo("capVtn", "rpc/cambiar_estado_backlog", { method: "POST", body: JSON.stringify({ p_id: blVtn, p_estado: estado, p_datos: {} }) });
    if (!rr.ok) throw new Error(`Backlog de Veta Nueva a ${estado}: ${rr.status} ${await rr.text()}`);
  }
  await pv.goto(base + `#/backlog/${blVtn}`);
  await esperarEstado(pv, "Listo para programar");
  await transicion(pv, "Programar", async (d) => {
    await d.getByText("N° OT (opcional)").waitFor();
    await d.getByLabel("Fecha programada").fill(diaPm);
    if (await d.getByRole("button", { name: "Programar", exact: true }).isDisabled()) throw new Error("Fuera de SAP no deja programar sin OT");
  });
  await esperarEstado(pv, "Programado");
  const otBl = (await (await pedirComo("admin", `backlogs?select=ot_sap&id=eq.${blVtn}`)).json())[0].ot_sap;
  if (otBl !== "OT-VTN-000002") throw new Error(`OT del backlog de Veta Nueva: ${otBl}`);
  await pv.goto(base + "#/calendario");
  await pv.locator(".grilla-semana").getByLabel("BL-VTN-000001 PS090").locator(".tc-pm", { hasText: "con PM" }).waitFor();
  ok("un correctivo sin SAP programado sin OT recibe OT-VTN-000002 y en el calendario sale «con PM»");

  // Cierre: fecha, horómetro, ejecutado por y materiales utilizados.
  await pv.goto(base + "#/preventivos");
  await pv.getByRole("link", { name: "PM-VTN-000001" }).click();
  await pv.getByRole("heading", { name: "PS090 · PM 250 h motor diésel" }).waitFor();
  const idPm = pv.url().split("/preventivo/")[1];
  await pv.getByLabel("Observaciones", { exact: true }).fill("Llevar filtros del kit de 250 h");
  await pv.getByLabel("Observaciones", { exact: true }).blur();
  await pv.locator(".ficha-acciones").getByRole("button", { name: "Marcar ejecutado" }).click();
  const dEj = pv.getByRole("dialog");
  await dEj.waitFor();
  const material = async (parte, desc, cant, um, item) => {
    await dEj.getByLabel("Número de parte del material nuevo").fill(parte);
    await dEj.getByLabel("Descripción del material nuevo").fill(desc);
    await dEj.getByLabel("Cantidad del material nuevo").fill(cant);
    await dEj.getByLabel("Unidad del material nuevo").fill(um);
    await dEj.getByRole("button", { name: "Agregar" }).click();
    await dEj.getByLabel(`Descripción material ${item}`).waitFor();
  };
  await material("1R-0739", "Filtro de aceite de motor", "2", "un", 1);
  await material("", "Aceite 15W40", "20", "L", 2);
  if (await dEj.getByRole("columnheader", { name: "Código SAP" }).count()) throw new Error("Veta Nueva ve Código SAP en los materiales");
  await dEj.getByRole("columnheader", { name: "Cód. interno" }).waitFor();
  const fechaEj = diaPm; // se propone la fecha programada, aunque sea posterior a hoy (023)
  if ((await dEj.getByLabel("Fecha de ejecución del preventivo").inputValue()) !== fechaEj) throw new Error("La fecha de ejecución propuesta no es la esperada");
  await dEj.getByLabel("Horómetro al ejecutar").fill("1262");
  await dEj.getByLabel("Ejecutado por").fill("Mecánico turno A");
  await dEj.getByLabel("Comentario de cierre").fill("Sin novedades");
  await pv.screenshot({ path: join(SALIDA, "preventivo-ejecutar.png") });
  await dEj.getByRole("button", { name: "Marcar ejecutado", exact: true }).click();
  await esperarEstado(pv, "Ejecutado");
  await pv.getByRole("button", { name: "Programar el siguiente" }).waitFor();
  if (await pv.locator(".ficha-acciones").getByRole("button", { name: "Marcar ejecutado" }).count()) throw new Error("El capturador aún puede ejecutar un preventivo ejecutado");
  if (await pv.locator(".ficha-acciones").getByRole("button", { name: "Volver a programado" }).count()) throw new Error("El capturador puede revertir un preventivo ejecutado");
  if (await pv.getByLabel("Descripción material 1").count()) throw new Error("El capturador puede editar materiales de un preventivo ejecutado");
  const pmBd = (await (await pedirComo("admin", `v_preventivos?select=*&id=eq.${idPm}`)).json())[0];
  if (pmBd.estado !== "Ejecutado" || pmBd.fecha_ejecucion !== fechaEj || Number(pmBd.horometro_ejecucion) !== 1262 || pmBd.materiales_total !== 2 ||
      pmBd.ejecutado_por !== "Mecánico turno A" || pmBd.observaciones !== "Llevar filtros del kit de 250 h" || pmBd.reprogramaciones !== 1)
    throw new Error(`Preventivo en la base: ${JSON.stringify(pmBd)}`);
  await pv.screenshot({ path: join(SALIDA, "preventivo-ficha.png"), fullPage: true });
  ok("el capturador cierra el preventivo con horómetro, responsable y 2 materiales; ejecutado queda bloqueado para él");

  // OT impresa: datos, materiales y el renglón de la pauta adjunta; sin tareas ni SAP.
  const [vOt] = await Promise.all([pv.context().waitForEvent("page"), pv.getByRole("button", { name: "Imprimir OT" }).click()]);
  await vOt.waitForFunction(() => document.title && !document.title.startsWith("Generando"));
  const htmlOt = await vOt.content();
  for (const t of ["MANTENIMIENTO PREVENTIVO", "OT-VTN-000001", "PM-VTN-000001", "PM 250 h motor diésel", "1R-0739", "Aceite 15W40",
                   "Pauta de mantenimiento y listado de filtros adjuntos", "Mecánico turno A</div><div class=\"linea\">Ejecutado por", "<th>Cód. interno</th>"])
    if (!htmlOt.includes(t)) throw new Error(`La OT del preventivo no tiene «${t}»`);
  if (htmlOt.includes("SAP")) throw new Error("La OT de Veta Nueva menciona SAP");
  if (!htmlOt.includes("data:image/png")) throw new Error("La OT no lleva el logo incrustado");
  await vOt.setViewportSize({ width: 900, height: 1270 });
  await vOt.screenshot({ path: join(SALIDA, "ot-preventivo.png"), fullPage: true });
  await vOt.close();
  await pv.context().close();
  ok("la OT impresa del preventivo trae datos, materiales, firma y el renglón de la pauta adjunta");

  // HEMCO: la OT es la de SAP y es obligatoria. Anular pide motivo. El admin revierte.
  const ph = await abrir("cap");
  await ph.goto(base + "#/preventivos");
  await ph.getByRole("button", { name: "Programar preventivo" }).click();
  const dH = ph.getByRole("dialog");
  await dH.getByLabel("Equipo del preventivo").selectOption({ label: "PS011 · ST1030" });
  await dH.getByLabel("Actividad del preventivo").fill("PM 500 h motor diésel");
  await dH.locator(".nota", { hasText: "Falta: OT SAP" }).waitFor();
  if (!(await dH.getByRole("button", { name: "Programar", exact: true }).isDisabled())) throw new Error("HEMCO deja programar un preventivo sin OT de SAP");
  await dH.getByLabel("N° de OT del preventivo").fill("4500777");
  await dH.getByRole("button", { name: "Programar", exact: true }).click();
  await aviso(ph, "PM-HEM-000001 programado · OT 4500777");
  if (await ph.locator(".tabla-preventivos tbody tr", { hasText: "PM-VTN-000001" }).count()) throw new Error("El capturador de HEMCO ve preventivos de Veta Nueva");
  await ph.getByRole("button", { name: "Anular PM-HEM-000001" }).click();
  const dAn = ph.getByRole("dialog");
  if (!(await dAn.getByRole("button", { name: "Anular", exact: true }).isDisabled())) throw new Error("Deja anular el preventivo sin motivo");
  await dAn.getByLabel("Motivo").fill("Se programó por error");
  await dAn.getByRole("button", { name: "Anular", exact: true }).click();
  await aviso(ph, "PM-HEM-000001: Anulado");
  await ph.getByLabel("Estado de los preventivos").selectOption("Anulado");
  await ph.locator(".tabla-preventivos tbody tr", { hasText: "PM-HEM-000001" }).waitFor();
  if (await ph.getByRole("button", { name: "Volver a programado PM-HEM-000001" }).count()) throw new Error("El capturador puede reabrir un preventivo anulado");
  await ph.context().close();
  await adm.goto(base + `#/preventivo/${idPm}`);
  await adm.reload();
  await adm.locator(".ficha-folio .etiqueta-estado", { hasText: "Ejecutado" }).waitFor();
  await adm.getByLabel("Cantidad material 1").fill("3");
  await adm.getByLabel("Cantidad material 1").blur();
  await adm.locator(".ficha-acciones").getByRole("button", { name: "Volver a programado" }).click();
  const dRev = adm.getByRole("dialog");
  await dRev.getByLabel("Motivo").fill("Faltó registrar el filtro de aire");
  await dRev.getByRole("button", { name: "Volver a programado", exact: true }).click();
  await adm.locator(".ficha-folio .etiqueta-estado", { hasText: "Programado" }).waitFor();
  await adm.locator(".bitacora .evento-cambio", { hasText: "Reversión" }).waitFor();
  const cant1 = (await (await pedirComo("admin", `preventivo_materiales?select=cantidad&preventivo_id=eq.${idPm}&item=eq.1`)).json())[0].cantidad;
  if (Number(cant1) !== 3) throw new Error(`El admin no pudo corregir el material del ejecutado: ${cant1}`);
  ok("HEMCO exige la OT de SAP; anular pide motivo; solo el admin corrige materiales de un ejecutado y lo vuelve a Programado");

  // 8. Paquete de órdenes (022): PS090 tiene ese día el preventivo y un correctivo.
  await adm.goto(base + "#/calendario");
  await adm.reload();
  await adm.getByRole("heading", { name: "Calendario" }).waitFor();
  await adm.getByRole("button", { name: `Paquete PS090 ${ddmm(diaPm)}` }).click();
  const dPq = adm.getByRole("dialog");
  await dPq.getByText("El número de paquete se asigna al imprimir").waitFor();
  if ((await dPq.locator(".tabla-ordenes-paquete tbody tr").count()) !== 2) throw new Error("El paquete de PS090 no muestra sus 2 órdenes");
  await adm.screenshot({ path: join(SALIDA, "paquete-vista-previa.png") });
  const [vPq] = await Promise.all([adm.context().waitForEvent("page"), dPq.getByRole("button", { name: "Imprimir paquete" }).click()]);
  await vPq.waitForFunction(() => document.title && !document.title.startsWith("Generando"));
  const htmlPq = await vPq.content();
  for (const t of ["PAQUETE DE ÓRDENES DE TRABAJO", "PQ-VTN-000001", "OT-VTN-000001", "OT-VTN-000002", "PM-VTN-000001", "BL-VTN-000001",
                   "MANTENIMIENTO PREVENTIVO", "MANTENIMIENTO CORRECTIVO PROGRAMADO", "Fuga de refrigerante en radiador", "PM 250 h motor diésel",
                   "Pauta de mantenimiento y listado de filtros adjuntos", "Entregado por (planificador)", "Mecánico 1 × 3 h", "Filtro de aceite de motor"])
    if (!htmlPq.includes(t)) throw new Error(`El paquete no tiene «${t}»`);
  if ((htmlPq.match(/<div class="hoja/g) ?? []).length !== 3) throw new Error("El paquete debía tener 3 hojas: carátula, preventivo y correctivo");
  if (!/<span class="et">Paquete<\/span>PQ-VTN-000001/.test(htmlPq)) throw new Error("La OT del preventivo no lleva el N° de paquete");
  if (htmlPq.includes("SAP")) throw new Error("El paquete de Veta Nueva menciona SAP");
  await vPq.setViewportSize({ width: 900, height: 1270 });
  await vPq.locator(".hoja").first().screenshot({ path: join(SALIDA, "paquete-caratula.png") });
  await vPq.screenshot({ path: join(SALIDA, "paquete.png"), fullPage: true });
  await vPq.close();
  await aviso(adm, "PQ-VTN-000001 listo para imprimir");
  ok("el paquete de PS090 sale con carátula, la OT del preventivo y el formato del correctivo, y toma el número PQ-VTN-000001");

  // Todos los paquetes de un día en un solo PDF; el número de PS090 no cambia.
  const [vDia] = await Promise.all([adm.context().waitForEvent("page"), adm.getByRole("button", { name: `Imprimir paquetes del ${ddmm(diaPm)}` }).click()]);
  await vDia.waitForFunction(() => document.title && !document.title.startsWith("Generando"));
  const htmlDia = await vDia.content();
  if (!htmlDia.includes("PQ-VTN-000001") || htmlDia.includes("PQ-VTN-000002")) throw new Error("Paquetes del día: PS090 debía conservar PQ-VTN-000001");
  await vDia.close();
  await adm.goto(base + "#/paquetes");
  const filaPq = adm.locator(".tabla-paquetes tbody tr", { hasText: "PQ-VTN-000001" });
  await filaPq.locator("td", { hasText: "0 de 2 ejecutadas" }).waitFor();
  await filaPq.locator(".nota", { hasText: "2 impresiones" }).waitFor();
  await adm.screenshot({ path: join(SALIDA, "paquetes.png") });
  ok("los paquetes del día salen en un solo PDF y la lista de paquetes muestra el avance y las impresiones");

  // Vista mensual del calendario: un botón por equipo y día abre su paquete.
  await adm.goto(base + "#/calendario");
  await adm.getByRole("button", { name: "Mes", exact: true }).click();
  const MESES_ES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  const lunesSemana = lunesIso(enDias(0));
  await adm.locator(".semana-titulo", { hasText: `${MESES_ES[Number(lunesSemana.slice(5, 7)) - 1]} de ${lunesSemana.slice(0, 4)}` }).waitFor();
  if (await adm.locator(".grilla-semana").count()) throw new Error("La vista Mes sigue mostrando la grilla semanal");
  const botonMes = adm.locator(".mes").getByRole("button", { name: `Paquete PS090 ${ddmm(diaPm)}` });
  await botonMes.locator(".paquete-mes-folio", { hasText: "PQ-VTN-000001" }).waitFor();
  if (!(await botonMes.textContent()).includes("1 PM + 1 correctivo")) throw new Error(`Botón del mes: ${await botonMes.textContent()}`);
  await adm.screenshot({ path: join(SALIDA, "calendario-mes.png"), fullPage: true });
  await botonMes.click();
  const dMes = adm.getByRole("dialog");
  await dMes.getByText("PQ-VTN-000001, impreso 2").waitFor();
  await dMes.getByRole("button", { name: "Cerrar" }).click();
  await adm.locator(".mes").getByRole("button", { name: `Programar preventivo el ${ddmm(diaPm)}` }).click({ force: true });
  if ((await adm.getByRole("dialog").getByLabel("Fecha programada del preventivo").inputValue()) !== diaPm) throw new Error("+ PM del mes no trae el día");
  await adm.getByRole("dialog").getByRole("button", { name: "Cancelar" }).click();
  await adm.reload();
  await adm.locator(".mes").waitFor();
  await adm.getByRole("button", { name: `Ver semana del ${ddmm(lunesIso(diaPm))}` }).click();
  await adm.locator(".grilla-semana").getByLabel("PM-VTN-000001 PS090").waitFor();
  await adm.locator(".semana-titulo", { hasText: `Semana del ${ddmm(lunesIso(diaPm))}` }).waitFor();
  ok("el calendario alterna entre Semana y Mes; en el mes cada equipo y día abre su paquete y la vista se recuerda");

  // Excel de Indicadores con las hojas de preventivos.
  await adm.goto(base + "#/indicadores");
  await adm.getByRole("heading", { name: "Indicadores" }).waitFor();
  await adm.locator(".tile", { hasText: "Preventivos de la semana" }).waitFor();
  const [descargaPm] = await Promise.all([adm.waitForEvent("download"), adm.getByRole("button", { name: "Exportar a Excel" }).click()]);
  const rutaPm = join(SALIDA, "backlog-con-preventivos.xlsx");
  await descargaPm.saveAs(rutaPm);
  const libroPm = new (require("exceljs").Workbook)();
  await libroPm.xlsx.readFile(rutaPm);
  const hPm = libroPm.getWorksheet("Preventivos");
  const hMat = libroPm.getWorksheet("Materiales de preventivos");
  if (!hPm || !hMat) throw new Error(`Faltan las hojas de preventivos: ${libroPm.worksheets.map((h) => h.name).join(" | ")}`);
  const filasPm = hPm.getRows(2, hPm.rowCount - 1) ?? [];
  if (filasPm.length !== 2 || !filasPm.some((r) => r.values.includes("PM-VTN-000001") && r.values.includes("OT-VTN-000001")) ||
      !filasPm.some((r) => r.values.includes("PM-HEM-000001") && r.values.includes("Anulado")))
    throw new Error(`Hoja Preventivos: ${filasPm.map((r) => r.values.join(",")).join(" / ")}`);
  const filasMat = hMat.getRows(2, hMat.rowCount - 1) ?? [];
  if (filasMat.length !== 2 || !filasMat.some((r) => r.values.includes("1R-0739") && r.values.includes("PM 250 h motor diésel")))
    throw new Error(`Hoja Materiales de preventivos: ${filasMat.length} líneas`);
  ok("el Excel trae las hojas Preventivos y Materiales de preventivos");

  // 9. Logo solo de Explotec para usuarios @explotec.com (v0.6.3). Sara Lira (EXP) crea e imprime;
  // el admin (otro dominio) imprime lo de ella y ella imprime lo del admin.
  const soloExplotec = (html, que) => {
    if (!html.includes('alt="Explotec"')) throw new Error(`${que}: falta el logo de Explotec`);
    if (html.includes('alt="Dimelco"') || html.includes("Dimelco")) throw new Error(`${que}: no debe mencionar a Dimelco`);
    if (!html.includes("Control de Backlog · Explotec")) throw new Error(`${que}: el pie debe decir Explotec`);
  };
  const dosLogos = (html, que) => {
    if (!html.includes('alt="Explotec"') || !html.includes('alt="Dimelco"')) throw new Error(`${que}: debía llevar los dos logos`);
    if (!html.includes("Control de Backlog · Dimelco")) throw new Error(`${que}: el pie debía decir Dimelco`);
  };
  const imprimirOtDe = async (pagina, ruta, titulo) => {
    await pagina.goto(base + ruta);
    await pagina.reload();
    await pagina.getByRole("heading", { name: titulo }).waitFor();
    const [v] = await Promise.all([pagina.context().waitForEvent("page"), pagina.getByRole("button", { name: "Imprimir OT" }).click()]);
    await v.waitForFunction(() => document.title && !document.title.startsWith("Generando"));
    return v;
  };
  const sara = await abrir("capExp");
  await sara.goto(base + "#/preventivos");
  await sara.getByRole("button", { name: "Programar preventivo" }).click();
  const dSara = sara.getByRole("dialog");
  await dSara.getByLabel("Equipo del preventivo").selectOption({ label: "B1-20 · SmartROC T40" });
  await dSara.getByLabel("Actividad del preventivo").fill("PM 250 h SmartROC");
  await dSara.getByRole("button", { name: "Programar", exact: true }).click();
  await aviso(sara, "PM-EXP-000001 programado · OT OT-EXP-000001");
  await sara.getByRole("link", { name: "PM-EXP-000001" }).click();
  await sara.getByRole("heading", { name: "B1-20 · PM 250 h SmartROC" }).waitFor();
  const idPmSara = sara.url().split("/preventivo/")[1];
  const [vSara] = await Promise.all([sara.context().waitForEvent("page"), sara.getByRole("button", { name: "Imprimir OT" }).click()]);
  await vSara.waitForFunction(() => document.title && !document.title.startsWith("Generando"));
  soloExplotec(await vSara.content(), "OT impresa por Sara");
  await vSara.setViewportSize({ width: 900, height: 1270 });
  await vSara.screenshot({ path: join(SALIDA, "ot-solo-explotec.png"), fullPage: true });
  await vSara.close();
  const vAdmSara = await imprimirOtDe(adm, `#/preventivo/${idPmSara}`, "B1-20 · PM 250 h SmartROC");
  soloExplotec(await vAdmSara.content(), "OT de Sara impresa por el admin");
  await vAdmSara.close();
  ok("el preventivo creado por un usuario @explotec.com se imprime solo con el logo de Explotec, también cuando lo imprime el admin");

  // Un preventivo creado por el admin en la misma unidad: dos logos para el admin, solo Explotec si lo imprime Sara.
  const eqExp = (await (await pedirComo("admin", "equipos?select=id&cod_interno=eq.B1-20")).json())[0].id;
  const rPm2 = await pedirComo("admin", "preventivos", {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({ equipo_id: eqExp, actividad: "PM 500 h SmartROC", fecha_programada: enDias(0) }),
  });
  if (!rPm2.ok) throw new Error(`Preventivo del admin en B1-20: ${rPm2.status} ${await rPm2.text()}`);
  const jPm2 = await rPm2.json();
  const idPmAdm = (Array.isArray(jPm2) ? jPm2[0] : jPm2).id;
  const vAdm = await imprimirOtDe(adm, `#/preventivo/${idPmAdm}`, "B1-20 · PM 500 h SmartROC");
  dosLogos(await vAdm.content(), "OT del admin impresa por el admin");
  await vAdm.close();
  const vSaraAdm = await imprimirOtDe(sara, `#/preventivo/${idPmAdm}`, "B1-20 · PM 500 h SmartROC");
  soloExplotec(await vSaraAdm.content(), "OT del admin impresa por Sara");
  await vSaraAdm.close();
  ok("la OT del admin lleva los dos logos si la imprime el admin y solo Explotec si la imprime un usuario @explotec.com");

  // Paquete de B1-20 de hoy (2 preventivos): quien imprime decide el logo de todas las hojas.
  const abrirPaqueteExp = async (pagina) => {
    await pagina.goto(base + "#/calendario");
    await pagina.reload();
    await pagina.getByRole("button", { name: `Paquete B1-20 ${ddmm(enDias(0))}` }).click();
    const d = pagina.getByRole("dialog");
    await d.locator(".tabla-ordenes-paquete tbody tr").nth(1).waitFor();
    const [v] = await Promise.all([pagina.context().waitForEvent("page"), d.getByRole("button", { name: "Imprimir paquete" }).click()]);
    await v.waitForFunction(() => document.title && !document.title.startsWith("Generando"));
    return v;
  };
  const vPaqSara = await abrirPaqueteExp(sara);
  const htmlPaqSara = await vPaqSara.content();
  soloExplotec(htmlPaqSara, "Paquete impreso por Sara");
  if ((htmlPaqSara.match(/<div class="hoja/g) ?? []).length !== 3) throw new Error("El paquete de B1-20 debía tener carátula y 2 preventivos");
  if (!htmlPaqSara.includes("PQ-EXP-000001")) throw new Error("El paquete de B1-20 debía ser PQ-EXP-000001");
  await vPaqSara.setViewportSize({ width: 900, height: 1270 });
  await vPaqSara.locator(".hoja").first().screenshot({ path: join(SALIDA, "paquete-solo-explotec.png") });
  await vPaqSara.close();
  const vPaqAdm = await abrirPaqueteExp(adm);
  const htmlPaqAdm = await vPaqAdm.content();
  dosLogos(htmlPaqAdm, "Paquete impreso por el admin");
  if (!htmlPaqAdm.includes("PQ-EXP-000001")) throw new Error("El admin debía recuperar PQ-EXP-000001");
  await vPaqAdm.close();
  await sara.context().close();
  ok("el paquete de B1-20 sale solo con Explotec si lo imprime un usuario @explotec.com y con los dos logos si lo imprime el admin");

  // 10. Ejecución con fecha futura (023): el BL-VTN-000001 se marca ejecutado dentro de 5 días.
  const blFut = "30000000-0000-0000-0000-000000000005";
  const espFut = (await (await pedirComo("admin", "especialidades?select=id&nombre=eq.Mecánico")).json())[0].id;
  const rHh = await pedirComo("capVtn", "backlog_hh", { method: "POST", body: JSON.stringify({ backlog_id: blFut, especialidad_id: espFut, tipo: "real", personas: 1, horas: 3 }) });
  if (!rHh.ok) throw new Error(`HH reales del BL-VTN-000001: ${rHh.status} ${await rHh.text()}`);
  const fut = await abrir("capVtn");
  await fut.goto(base + `#/backlog/${blFut}`);
  await esperarEstado(fut, "Programado");
  await fut.locator(".ficha-acciones").getByRole("button", { name: "Marcar ejecutado", exact: true }).click();
  const dFut = fut.getByRole("dialog");
  const campoFut = dFut.getByLabel("Fecha de ejecución");
  if (await campoFut.getAttribute("max")) throw new Error("La fecha de ejecución sigue con tope en hoy");
  await campoFut.fill(enDias(5));
  await dFut.locator(".nota", { hasText: "ejecución futura" }).waitFor();
  await fut.screenshot({ path: join(SALIDA, "ejecutar-fecha-futura.png") });
  await dFut.getByRole("button", { name: "Marcar ejecutado", exact: true }).click();
  await esperarEstado(fut, "Ejecutado");
  const fEj = (await (await pedirComo("admin", `backlogs?select=fecha_ejecucion&id=eq.${blFut}`)).json())[0].fecha_ejecucion;
  if (fEj !== enDias(5)) throw new Error(`Fecha de ejecución ${fEj}, esperada ${enDias(5)}`);
  await fut.context().close();
  ok("un backlog programado se marca ejecutado con una fecha posterior a hoy");

  // 6. Vista de celular.
  const movil = await abrir("cap", 390, 844);
  await movil.goto(base + `#/backlog/${id}`);
  await esperarEstado(movil, "Validado");
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
