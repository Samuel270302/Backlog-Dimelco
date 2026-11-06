// Prueba del reporte semanal por correo contra el PostgreSQL local con la semilla:
// compila tools/reporte_correo.ts, lo corre sin enviar y revisa PDF, Excel y cuerpo.
// Uso: SIN_BUILD=1 tests/e2e.sh reporte_correo.mjs
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const RAIZ = new URL("..", import.meta.url).pathname;
const SALIDA = join(RAIZ, "capturas", "correo");
rmSync(SALIDA, { recursive: true, force: true });
let paso = 0;
const ok = (t) => console.log(`ok ${++paso} - ${t}`);

try {
  execFileSync("npm", ["run", "-s", "reporte:correo:compilar"], { cwd: RAIZ, stdio: "inherit" });
  const out = execFileSync("node", [join(RAIZ, "tools/dist/reporte_correo.mjs"), "--sin-enviar", "--salida", SALIDA], {
    cwd: RAIZ,
    env: { ...process.env, PGUSER: "postgres", PGDATABASE: "postgres", PGOPTIONS: "" },
    encoding: "utf8",
  });
  const r = JSON.parse(out.trim().split("\n").pop());
  if (r.enviado !== false || r.adjuntos.length !== 2) throw new Error(`Resumen inesperado: ${out}`);
  if (!/^Reporte semanal de backlog · semana del \d{2}\/\d{2}\/\d{4}$/.test(r.asunto)) throw new Error(`Asunto: ${r.asunto}`);
  if (r.abiertos !== 5) throw new Error(`Abiertos de la semilla: ${r.abiertos}`);
  ok(`mensaje armado sin enviar: «${r.asunto}», 2 adjuntos, 5 abiertos`);

  const archivos = readdirSync(SALIDA);
  const pdf = readFileSync(join(SALIDA, archivos.find((f) => f.endsWith(".pdf"))));
  const caja = /\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(pdf.toString("latin1"));
  if (!pdf.subarray(0, 4).toString().startsWith("%PDF") || !caja || !(Number(caja[3]) > Number(caja[4])))
    throw new Error("El PDF no es A4 horizontal");
  ok(`PDF del reporte semanal A4 horizontal (${Math.round(caja[3])} × ${Math.round(caja[4])} pt, ${Math.round(pdf.length / 1024)} KB)`);

  const ExcelJS = require("exceljs");
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.readFile(join(SALIDA, archivos.find((f) => f.endsWith(".xlsx"))));
  const hojas = libro.worksheets.map((h) => h.name).join(" | ");
  if (hojas !== "Backlogs abiertos | Cerrados últimos 7 días | Semanas de backlog") throw new Error(`Hojas: ${hojas}`);
  if (libro.getWorksheet("Backlogs abiertos").rowCount !== 6) throw new Error("El Excel no trae los 5 abiertos");
  ok("Excel con hojas Backlogs abiertos (5), Cerrados últimos 7 días y Semanas de backlog");

  const cuerpo = readFileSync(join(SALIDA, "correo.html"), "utf8");
  for (const t of ["HEMCO", "Veta Nueva", "Todas las unidades", "backlogs abiertos", "semanas de backlog"])
    if (!cuerpo.includes(t)) throw new Error(`El cuerpo no tiene «${t}»`);
  let playwright;
  try { playwright = require("playwright"); } catch { playwright = require("/opt/node-tools/node_modules/playwright/index.js"); }
  const nav = await playwright.chromium.launch();
  const p = await nav.newPage({ viewport: { width: 900, height: 600 } });
  await p.goto("file://" + join(SALIDA, "correo.html"));
  await p.screenshot({ path: join(SALIDA, "correo.png"), fullPage: true });
  await nav.close();
  ok("cuerpo del correo con las cifras por unidad (HEMCO, Veta Nueva) y el total");
  console.log(`\nPRUEBA CORREO OK: ${paso} pasos`);
} catch (e) {
  console.error(`\nFALLA después del paso ${paso}: ${e.message}`);
  process.exitCode = 1;
}
