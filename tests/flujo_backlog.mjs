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
  if (await cap.locator(".ficha-acciones button", { hasNotText: /Imprimir formato|^Borrar$/ }).count())
    throw new Error("El capturador ve acciones de admin en Identificado");
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
  if (await cap.locator('.pagina-calendario [draggable="true"]').count()) throw new Error("El capturador puede arrastrar en el calendario");
  ok("el capturador ve el calendario pero no puede arrastrar");

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

  const [descarga] = await Promise.all([adm.waitForEvent("download"), adm.getByRole("button", { name: "Exportar abiertos a Excel" }).click()]);
  const rutaXlsx = join(SALIDA, "backlog-abierto.xlsx");
  await descarga.saveAs(rutaXlsx);
  const ExcelJS = require("exceljs");
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.readFile(rutaXlsx);
  const hojaAb = libro.getWorksheet("Backlogs abiertos");
  if (hojaAb.rowCount !== 7) throw new Error(`El Excel debía tener 6 abiertos, tiene ${hojaAb.rowCount - 1}`);
  const mec = libro.getWorksheet("Semanas de backlog").getRows(2, 10).find((r) => r.getCell(1).value === "Mecánico");
  if (Math.abs(mec.getCell(4).value - 0.85) > 1e-9) throw new Error("Excel: semanas de Mecánico distinto de 0,85");
  ok("Excel con 6 backlogs abiertos y hoja de semanas de backlog");

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
  if (await cap.locator(".ficha-acciones").getByRole("button", { name: "Reprogramar" }).count())
    throw new Error("El capturador ve Reprogramar");
  await transicion(cap, "Marcar ejecutado", (d) => d.getByLabel(/Comentario/).fill("Se cambiaron sellos y se probó el levante"));
  await esperarEstado(cap, "Ejecutado");
  ok("capturador carga 10 HH reales y marca ejecutado");

  // 5. El admin cierra; la ficha queda de solo lectura.
  await adm.goto(base + `#/backlog/${id}`);
  await adm.reload();
  await esperarEstado(adm, "Ejecutado");
  await transicion(adm, "Validar");
  await esperarEstado(adm, "Validado");
  await adm.getByLabel("Avance: paso 5 de 5, Validado").waitFor();
  if (await adm.locator(".ficha-acciones button", { hasNotText: /Imprimir formato|^Borrar$/ }).count())
    throw new Error("Quedan acciones en un backlog cerrado");
  await adm.getByRole("tab", { name: "Datos" }).click();
  if (!(await adm.locator("label.campo", { hasText: "Descripción del trabajo" }).locator("input").isDisabled()))
    throw new Error("Datos editables en un backlog cerrado");
  const deteccion = await adm.locator("label.campo", { hasText: "Fecha de detección" }).locator("input").inputValue();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(deteccion)) throw new Error(`Fecha de detección vacía o mal formada: «${deteccion}»`);
  ok("admin valida (paso 5 de 5) y la ficha queda de solo lectura");

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
  if (await vtn.getByLabel("Código ítem 1").count()) throw new Error("Veta Nueva ve Código SAP del repuesto");
  if (await vtn.getByRole("columnheader", { name: "Código SAP" }).count()) throw new Error("Veta Nueva ve la columna Código SAP");
  ok("Veta Nueva registra sin Aviso SAP ni Código SAP");

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
