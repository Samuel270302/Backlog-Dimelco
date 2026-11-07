// Arma docs/manual/Manual_capturador_Backlog_Dimelco.pdf con las capturas de
// docs/manual/img (tests/e2e.sh manual_capturador.mjs). Uso: node tools/armar_manual.mjs
import { createRequire } from "node:module";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require("playwright");
} catch {
  playwright = require("/opt/node-tools/node_modules/playwright/index.js");
}

const RAIZ = new URL("..", import.meta.url).pathname;
const DIR = join(RAIZ, "docs", "manual");
const IMG = join(DIR, "img");
const archivos = readdirSync(IMG);
const img = (clave) => {
  const f = archivos.find((a) => a.slice(3).startsWith(clave));
  if (!f) throw new Error(`Falta la captura ${clave}`);
  return `data:image/jpeg;base64,${readFileSync(join(IMG, f)).toString("base64")}`;
};
const logo = `data:image/png;base64,${readFileSync(join(RAIZ, "src", "assets", "logo-dimelco.png")).toString("base64")}`;
let nFig = 0;
const fig = (clave, pie, clase = "") => {
  nFig++;
  return `<figure class="${clase}"><img src="${img(clave)}"><figcaption>Figura ${nFig}. ${pie}</figcaption></figure>`;
};
const movil = (claves) =>
  `<div class="fila-movil">${claves.map(([c, p]) => fig(c, p, "movil")).join("")}</div>`;

const WEB = "https://samuel270302.github.io/Backlog-Dimelco/";
const DESCARGA = "https://github.com/Samuel270302/Backlog-Dimelco/releases/latest";

const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Manual del capturador</title>
<style>
  @page { size: A4; margin: 16mm 15mm 16mm 15mm; }
  * { box-sizing: border-box; }
  body { font: 10.5pt/1.5 "Segoe UI", Arial, sans-serif; color: #1c1c1c; margin: 0; }
  h1 { font-size: 19pt; margin: 0 0 8px; padding-bottom: 6px; border-bottom: 3px solid #f5b301; page-break-before: always; }
  h1.sin-salto { page-break-before: auto; }
  h2 { font-size: 13pt; margin: 18px 0 6px; color: #252525; }
  h3 { font-size: 11pt; margin: 14px 0 4px; }
  h1, h2, h3 { break-after: avoid; page-break-after: avoid; }
  figure.angosta img { max-height: 95mm; }
  p { margin: 5px 0; }
  ol, ul { margin: 5px 0 5px 20px; padding: 0; }
  li { margin: 3px 0; }
  li:has(> .paso) { list-style: none; margin-left: -18px; }
  figure { margin: 10px 0 14px; page-break-inside: avoid; text-align: center; }
  figure img { max-width: 100%; max-height: 118mm; border: 1px solid #c9c9c9; border-radius: 4px; }
  figure.alta img { max-height: 235mm; }
  figcaption { font-size: 9pt; color: #555; margin-top: 4px; }
  .fila-movil { display: flex; gap: 8mm; justify-content: center; page-break-inside: avoid; }
  .fila-movil figure.movil { width: 42%; }
  .fila-movil figure.movil img { max-height: 120mm; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0 12px; font-size: 9.8pt; page-break-inside: avoid; }
  th, td { border: 1px solid #c9c9c9; padding: 4px 7px; text-align: left; vertical-align: top; }
  th { background: #252525; color: #f5b301; }
  .nota { background: #fff7dc; border-left: 4px solid #f5b301; padding: 6px 10px; margin: 8px 0; }
  .alerta { background: #fdecec; border-left: 4px solid #c00000; padding: 6px 10px; margin: 8px 0; }
  .ejemplo { background: #eef4fb; border-left: 4px solid #1d4f7a; padding: 6px 10px; margin: 8px 0; }
  .paso { display: inline-block; min-width: 22px; height: 22px; line-height: 22px; text-align: center; border-radius: 11px; background: #252525; color: #f5b301; font-weight: 700; margin-right: 6px; font-size: 9.5pt; }
  .portada { height: 255mm; display: flex; flex-direction: column; justify-content: center; text-align: center; }
  .portada img { width: 70mm; margin: 0 auto 18mm; }
  .portada .titulo { font-size: 28pt; font-weight: 700; }
  .portada .sub { font-size: 15pt; color: #444; margin-top: 6px; }
  .portada .datos { margin-top: 30mm; font-size: 10.5pt; color: #555; }
  .indice li { margin: 2px 0; }
  .pri { display: inline-block; padding: 1px 8px; border-radius: 9px; font-weight: 700; font-size: 9pt; }
  code { background: #f1f1f1; padding: 0 4px; border-radius: 3px; }
</style></head><body>

<section class="portada">
  <img src="${logo}">
  <div class="titulo">Control de Backlog</div>
  <div class="sub">Manual del capturador</div>
  <div class="sub" style="font-size:12pt">Registro y seguimiento de backlogs de mantenimiento</div>
  <div class="datos">Dimelco · versión de la app 0.5.5 · noviembre de 2026</div>
</section>

<h1>Contenido</h1>
<ol class="indice">
  <li>Qué hace el capturador en la app</li>
  <li>Entrar a la app (PC y celular)</li>
  <li>La pantalla principal y el menú</li>
  <li>Conceptos que hay que conocer: estados, prioridades, tipo de pedido, familias y sistemas</li>
  <li>Registrar un backlog paso a paso (ejemplo completo)</li>
  <li>La ficha del backlog: datos, HH, repuestos, fotos, bitácora, formato impreso y borrar</li>
  <li>Avanzar y retroceder el backlog: aprobar, esperar repuestos, programar, reprogramar</li>
  <li>Seguir los backlogs: Kanban, Por equipo y Calendario</li>
  <li>Cerrar un trabajo: HH reales, Marcar ejecutado y Validar</li>
  <li>Indicadores y reporte semanal</li>
  <li>Capacidad del taller</li>
  <li>Uso desde el celular</li>
  <li>Preguntas frecuentes y mensajes de la app</li>
  <li>Resumen: qué puede y qué no puede hacer el capturador</li>
</ol>

<h1>1. Qué hace el capturador en la app</h1>
<p>Un <b>backlog</b> es un trabajo de mantenimiento pendiente en un equipo que no es urgente al punto de parar en el momento, pero que hay que planificar: una fuga, un desgaste, una pieza que hay que cambiar, un hallazgo de inspección o de un PM.</p>
<p>El capturador es quien detecta o recibe la necesidad en campo y la deja registrada en la app con toda la información que el planificador necesita para programarla. En la app el capturador:</p>
<ul>
  <li>registra backlogs nuevos de los equipos de sus unidades, con repuestos, horas hombre y fotos;</li>
  <li>corrige los datos de un backlog mientras está abierto (hasta que se valida);</li>
  <li>avanza el backlog por todo el flujo: lo aprueba, lo pasa a esperar repuestos, lo programa con fecha y OT, lo reprograma, lo marca ejecutado y lo valida;</li>
  <li>lo devuelve un paso atrás cuando hace falta, dejando el motivo;</li>
  <li>rechaza o anula un backlog que no procede, con motivo;</li>
  <li>carga y actualiza repuestos, HH estimadas y fotos mientras el backlog está abierto;</li>
  <li>deja comentarios en la bitácora;</li>
  <li>carga las HH reales de un trabajo terminado;</li>
  <li>edita la capacidad del taller de su unidad;</li>
  <li>borra un backlog mal registrado, dejando el motivo;</li>
  <li>consulta el Kanban, la vista por equipo, el calendario y los indicadores, e imprime el formato y el reporte.</li>
</ul>
<div class="nota">Una vez <b>Validado</b>, el backlog queda bloqueado para el capturador: ya no se edita ni se borra. Lo mismo pasa con un backlog <b>Rechazado</b> o <b>Anulado</b>. Solo el administrador puede revertirlos (devolverlos a un estado anterior) o borrarlos. El administrador también administra equipos, familias, sistemas, plazos y usuarios.</div>

<h1>2. Entrar a la app</h1>
<h2>2.1 Dónde está la app</h2>
<table>
  <tr><th>Versión</th><th>Cómo se abre</th></tr>
  <tr><td>PC (Windows 10 u 11)</td><td>Descargar el instalador de <code>${DESCARGA}</code> (archivo <code>Control-de-Backlog-Dimelco-Setup-x.x.x.exe</code>) y ejecutarlo. Si Windows muestra "Windows protegió su PC", pulsar <b>Más información</b> y luego <b>Ejecutar de todas formas</b>. La app se actualiza sola.</td></tr>
  <tr><td>Celular o tablet</td><td>Abrir en el navegador <code>${WEB}</code>. En Android (Chrome): menú de tres puntos, <b>Agregar a pantalla de inicio</b>. En iPhone (Safari): botón Compartir, <b>Agregar a inicio</b>.</td></tr>
</table>
<p>Las dos versiones usan el mismo usuario, la misma contraseña y los mismos datos. Lo que se registra en el celular se ve en la PC en segundos. La app necesita internet; sin conexión no graba.</p>

<h2>2.2 Iniciar sesión</h2>
<ol>
  <li><span class="paso">1</span>Escribir el <b>Correo</b> que le entregó el administrador (por ejemplo <code>planeador.martha@grupodimelco.com</code>).</li>
  <li><span class="paso">2</span>Escribir la <b>Contraseña</b> inicial.</li>
  <li><span class="paso">3</span>Pulsar <b>Entrar</b>.</li>
</ol>
${fig("login", "Pantalla de inicio de sesión.")}
<div class="nota">La primera vez, cambie la contraseña inicial por una propia: en el menú, abajo, botón <b>Cambiar contraseña</b> (figura 2). Mínimo 8 caracteres.</div>
${fig("cambiar-contrasena", "Cambiar contraseña desde el menú.")}

<h1>3. La pantalla principal y el menú</h1>
<p>Al entrar se abre <b>Por equipo</b>: los equipos de su unidad agrupados por familia, con cuántos backlogs abiertos tiene cada uno, las HH estimadas, el más antiguo, los urgentes y los vencidos.</p>
${fig("inicio-por-equipo", "Pantalla principal: Por equipo.")}
<p>El menú de la izquierda tiene:</p>
<table>
  <tr><th>Opción</th><th>Para qué sirve</th></tr>
  <tr><td>Nuevo backlog</td><td>Registrar un trabajo pendiente (capítulo 5).</td></tr>
  <tr><td>Por equipo</td><td>Ver los backlogs abiertos de cada equipo (capítulo 8).</td></tr>
  <tr><td>Kanban</td><td>Ver todos los backlogs por etapa (Identificado, Planeado, Programado, Ejecutado, Validado) y moverlos arrastrando la tarjeta.</td></tr>
  <tr><td>Calendario</td><td>Ver y programar los trabajos de cada día de la semana.</td></tr>
  <tr><td>Indicadores</td><td>HH acumuladas, antigüedad, vencidos, reporte semanal PDF y Excel (capítulo 10).</td></tr>
  <tr><td>Capacidad del taller</td><td>HH disponibles por semana de cada especialidad en su unidad (capítulo 11).</td></tr>
</table>
${fig("menu", "Menú del capturador. Arriba, la unidad; abajo, su nombre, Cambiar contraseña, Cerrar sesión y el estado de la conexión.", "angosta")}
<div class="nota">Arriba del menú aparece su unidad. Si el administrador le asignó más de una, ahí verá una lista para elegir una unidad o <b>Todas mis unidades</b>. Abajo, el punto verde con "En línea" indica que la app está conectada; si dice "Reconectando" o "Sin conexión", revise el internet antes de grabar.</div>

<h1>4. Conceptos que hay que conocer</h1>
<h2>4.1 Estados del backlog</h2>
<p>Cada backlog avanza por estas etapas. La barra de colores de cada tarjeta y de la ficha muestra en cuál va.</p>
<table>
  <tr><th>Etapa</th><th>Estado en la app</th><th>Quién lo cambia</th><th>Qué significa</th></tr>
  <tr><td>1. Identificado</td><td>Identificado</td><td>Se crea al registrar</td><td>El trabajo está detectado y registrado.</td></tr>
  <tr><td rowspan="3">2. Planeado</td><td>En planificación</td><td>Capturador o administrador (Aprobar y planificar)</td><td>Se aprobó; se confirman prioridad, HH y repuestos.</td></tr>
  <tr><td>Esperando repuestos</td><td>Capturador o administrador</td><td>Faltan repuestos por llegar.</td></tr>
  <tr><td>Listo para programar</td><td>Capturador o administrador, o solo al marcar recibido el último repuesto</td><td>Todo está disponible para hacer el trabajo.</td></tr>
  <tr><td>3. Programado</td><td>Programado</td><td>Capturador o administrador (Programar)</td><td>Tiene día asignado en el calendario y número de OT.</td></tr>
  <tr><td>4. Ejecutado</td><td>Ejecutado</td><td>Capturador o administrador</td><td>El trabajo se hizo; se cargaron las HH reales.</td></tr>
  <tr><td>5. Validado</td><td>Validado</td><td>Capturador o administrador</td><td>Se revisó y se cerró. Queda bloqueado: solo el administrador lo revierte o lo borra.</td></tr>
</table>
<p>Fuera del flujo: <b>Rechazado</b> (no procede) y <b>Anulado</b> (equipo dado de baja, duplicado), ambos con motivo. Los puede poner el capturador; reabrirlos lo hace solo el administrador.</p>
<p>Cada estado tiene un paso atrás (por ejemplo, de Programado a Listo para programar): se usa cuando algo cambió y siempre pide el motivo, que queda en la bitácora (capítulo 7).</p>

<h2>4.2 Prioridad</h2>
<p>La prioridad son los niveles de criticidad de la orden de trabajo de Dimelco. La app calcula la <b>fecha límite</b> sumando el plazo a la fecha de detección; pasada esa fecha, el backlog aparece como <b>vencido</b> (en rojo).</p>
<table>
  <tr><th>Color</th><th>Nivel</th><th>Plazo</th><th>Cuándo usarla (orientación)</th></tr>
  <tr><td><span class="pri" style="background:#e00000;color:#fff">1 Urgente</span></td><td>1 Urgente</td><td>Máximo 24 horas</td><td>Riesgo para la seguridad o falla inminente si sigue operando.</td></tr>
  <tr><td><span class="pri" style="background:#ffc000">2 Alto</span></td><td>2 Alto</td><td>Hasta 3 días</td><td>Puede operar con restricción; la falla avanza rápido.</td></tr>
  <tr><td><span class="pri" style="background:#ffff00">3 Medio</span></td><td>3 Medio</td><td>Hasta 14 días</td><td>Desgaste o falla que se programa en las próximas dos semanas.</td></tr>
  <tr><td><span class="pri" style="background:#00b050;color:#fff">4 Bajo</span></td><td>4 Bajo</td><td>Hasta 40 días</td><td>Mejora o corrección que puede esperar al siguiente PM.</td></tr>
</table>
<p>La prioridad que pone el capturador es una propuesta: el planificador la confirma o la cambia al aprobar.</p>

<h2>4.3 Tipo de pedido</h2>
<p><b>Normal</b> o <b>Urgente</b>, como en el formato en papel "Mantenimiento correctivo programado". Urgente marca la tarjeta con una etiqueta roja para que el planificador la vea primero.</p>

<h2>4.4 Familias y sistemas</h2>
<p>Cada equipo pertenece a una <b>familia</b> (Scooptram ST1030, Boomer S1D, PowerROC T35, Furukawa HCR, etc.). Cada familia tiene su lista de <b>sistemas</b>, tomada de los manuales de mantenimiento y de partes del fabricante. Al registrar, la app muestra solo los sistemas de la familia del equipo elegido, más la opción <b>Otro</b>. Si elige Otro, la app pide escribir cuál es el sistema.</p>
<p>El <b>componente</b> es la pieza o conjunto concreto dentro del sistema (por ejemplo, sistema "Sistema hidráulico", componente "Block de implementos").</p>

<h1>5. Registrar un backlog paso a paso</h1>
<div class="ejemplo"><b>Ejemplo que se usa en todo el capítulo.</b> En la inspección del Scooptram PS011 (ST1030, Epiroc) se encontró fuga de aceite en el block de implementos. Lo reportó el mecánico Xavier Araica y lo aprobó el supervisor Luis Mena. Hace falta reempacar el block con 3 kits de repuestos; el trabajo lleva 2 mecánicos 4 horas y 1 electromecánico 2 horas. Horómetro: 12 450 h. Aviso SAP: 10458732.</div>
<p>Pulse <b>Nuevo backlog</b> en el menú. Se abre el formulario, con el mismo orden del formato en papel. Abajo a la derecha, la app va diciendo qué falta para poder registrar ("Falta: equipo, sistema, ...").</p>
${fig("nuevo-vacio", "Formulario vacío. El texto marcado en rojo dice qué datos faltan.")}

<h2>5.1 Equipo</h2>
<p><span class="paso">1</span>En <b>Equipo</b>, abra la lista y elija el equipo. Los equipos están agrupados por familia (en negrita) y se muestran como <i>código interno · modelo</i>. Solo aparecen los equipos activos de sus unidades.</p>
${fig("nuevo-lista-equipos", "Lista de equipos agrupada por familia.")}
<p>Al elegirlo, debajo aparecen la familia, la marca, el modelo y el código interno. Confírmelos.</p>
${fig("nuevo-equipo-elegido", "Equipo PS011 elegido: la app muestra familia, marca, modelo y código interno.")}

<h2>5.2 Fecha, quién reporta, quién aprueba, tipo de pedido y prioridad</h2>
<ol>
  <li><span class="paso">2</span><b>Fecha</b>: el día en que se detectó la necesidad. Por defecto es hoy. No acepta fechas futuras.</li>
  <li><span class="paso">3</span><b>Reportado por</b>: nombre de quien vio o reportó la necesidad (obligatorio).</li>
  <li><span class="paso">4</span><b>Aprobado por</b>: nombre de quien aprueba que se convierta en backlog, por ejemplo el supervisor de turno (obligatorio). Los dos nombres salen en las firmas del formato impreso.</li>
  <li><span class="paso">5</span><b>Tipo de pedido</b>: Normal o Urgente.</li>
  <li><span class="paso">6</span><b>Prioridad</b>: 1 Urgente, 2 Alto, 3 Medio o 4 Bajo (ver 4.2).</li>
</ol>
${fig("nuevo-encabezado", "Reportado por, Aprobado por, tipo de pedido Urgente y prioridad 2 Alto.")}

<h2>5.3 Sistema y origen</h2>
<p><span class="paso">7</span>En <b>Sistema</b> aparecen solo los sistemas de la familia del equipo y, al final, <b>Otro</b>.</p>
${fig("nuevo-lista-sistemas", "Sistemas de la familia del equipo elegido, más Otro.")}
<p>Si el sistema no está en la lista, elija <b>Otro</b> y escriba cuál es en <b>¿Cuál sistema?</b>. Sin ese texto la app no deja registrar.</p>
${fig("nuevo-sistema-otro", "Con Otro aparece el campo ¿Cuál sistema?.")}
<p><span class="paso">8</span><b>Origen</b>: de dónde salió el hallazgo (Inspección, PM, Operador, Falla, Análisis de aceite, Otro).</p>
<p><span class="paso">9</span><b>Aviso SAP</b>: solo en HEMCO, si existe. En las demás unidades este campo no aparece.</p>
${fig("nuevo-sistema-origen", "Sistema hidráulico, origen Inspección y aviso SAP.")}

<h2>5.4 Trabajo</h2>
<ol>
  <li><span class="paso">10</span><b>Descripción del trabajo</b>: qué hay que hacer, en una línea clara (mínimo 5 letras). Escriba la acción y la causa: "Reempaque de block de implementos por fugas de aceite", no solo "fuga".</li>
  <li><span class="paso">11</span><b>Componente</b>: pieza o conjunto. Mientras escribe, la app sugiere componentes ya usados para que se escriban igual.</li>
  <li><span class="paso">12</span><b>Horómetro (h)</b>: lectura del equipo al detectar. Opcional, pero ayuda a ver la vida del componente.</li>
</ol>
${fig("nuevo-trabajo", "Sección Trabajo completa.")}

<h2>5.5 Repuestos</h2>
<p><span class="paso">13</span>Pulse <b>Agregar repuesto</b> una vez por cada repuesto. Cada fila tiene:</p>
<table>
  <tr><th>Columna</th><th>Qué escribir</th></tr>
  <tr><td>Ítem</td><td>Lo numera la app.</td></tr>
  <tr><td>Número de parte</td><td>El del fabricante (manual de partes). Obligatorio si no hay código SAP.</td></tr>
  <tr><td>Código SAP</td><td>Solo en HEMCO.</td></tr>
  <tr><td>Cant/Req</td><td>Cantidad requerida (mayor que 0).</td></tr>
  <tr><td>Stock</td><td>Cuántos hay en bodega, si lo sabe.</td></tr>
  <tr><td>Descripción del repuesto</td><td>Nombre de la pieza.</td></tr>
  <tr><td>Componente/Sistema</td><td>Dónde va montada.</td></tr>
  <tr><td>Observaciones</td><td>Cualquier aclaración (alternativa, proveedor, urgencia).</td></tr>
</table>
<p>Para quitar una fila, use la <b>×</b> al final. Si el trabajo no necesita repuestos, deje la sección vacía.</p>
${fig("nuevo-repuestos", "Tres repuestos con número de parte, cantidad, stock y descripción.")}

<h2>5.6 Especialidades y HH</h2>
<p><span class="paso">14</span>Pulse <b>Agregar especialidad</b> por cada oficio que interviene (Mecánico, Eléctrico, Electromecánico, Hidráulico, Soldador, Llantero). Escriba cuántas <b>Personas</b> y cuántas <b>Horas</b>; la app calcula las HH (personas × horas) y el total arriba a la derecha.</p>
<div class="ejemplo">2 mecánicos × 4 horas = 8 HH; 1 electromecánico × 2 horas = 2 HH; total 10 HH.</div>
${fig("nuevo-hh", "HH por especialidad con el total.")}
<p>Si no conoce las HH, deje la sección vacía: el planificador las carga al aprobar.</p>

<h2>5.7 Fotos</h2>
<p><span class="paso">15</span>Agregue fotos del hallazgo de dos maneras:</p>
<ul>
  <li>Botón <b>Agregar fotos</b>: abre la carpeta de la PC (o, en el celular, la cámara o la galería). Puede elegir varias a la vez.</li>
  <li><b>Pegar con Ctrl+V</b> (en PC): copie una imagen (captura de pantalla, foto de WhatsApp Web, imagen de un correo) y, con el cursor fuera de los campos de texto, pulse Ctrl+V. La foto se agrega a la lista.</li>
</ul>
<p>Las fotos se reducen solas antes de subir. Las fotos de un repuesto en particular se agregan después, en la ficha (6.4).</p>
${fig("nuevo-fotos", "Una foto agregada con el botón y otra pegada con Ctrl+V.")}

<h2>5.8 Justificación y registrar</h2>
<p><span class="paso">16</span>En <b>Justificación</b> explique por qué hay que hacer el trabajo y qué pasa si no se hace.</p>
<p><span class="paso">17</span>Cuando ya no aparezca el texto "Falta: ...", pulse <b>Registrar backlog</b>.</p>
${fig("nuevo-justificacion-registrar", "Justificación y botón Registrar backlog.")}
<p>La app graba todo junto, asigna el <b>folio</b> (por ejemplo BL-HEM-000005: BL, sigla de la unidad y número correlativo), muestra el aviso "Backlog ... registrado" y abre la ficha del backlog.</p>
${fig("nuevo-completo", "Formulario completo del ejemplo antes de registrar.", "alta")}

<h1>6. La ficha del backlog</h1>
<p>La ficha se abre al registrar, o desde cualquier folio (Kanban, Por equipo, Calendario). Arriba están el folio, el estado, la prioridad, el tipo de pedido y la barra de avance. A la derecha, los botones de acción. Debajo, cinco pestañas.</p>
${fig("ficha-datos", "Ficha del backlog recién registrado, pestaña Datos.")}

<h2>6.1 Datos</h2>
<p>Mientras el backlog está abierto (de Identificado hasta Ejecutado), el capturador puede corregir cualquier dato y pulsar <b>Grabar datos</b> (o <b>Deshacer</b> para volver a lo grabado). Al validarlo, los datos quedan solo para consulta.</p>
<p>Arriba se ven datos fijos: equipo, unidad, <b>fecha límite</b> (según la prioridad) y antigüedad en días.</p>

<h2>6.2 Repuestos</h2>
<p>Muestra cada ítem con su seguimiento: número de solicitud (SolPed, solo HEMCO), fecha estimada de llegada, estado (Por pedir, Pedido, Recibido) y fecha de recepción. El capturador puede agregar o quitar ítems y cambiar el estado mientras el backlog está abierto.</p>
<div class="nota">Cuando se marca <b>Recibido</b> el último repuesto pendiente, el backlog pasa solo a <b>Listo para programar</b> y queda anotado en la bitácora.</div>
${fig("ficha-repuestos", "Pestaña Repuestos.")}

<h2>6.3 HH</h2>
<p>Tiene dos tablas: <b>HH estimadas</b> (las del registro; se pueden corregir hasta que el trabajo se ejecute) y <b>HH reales</b> (se cargan cuando el backlog está Programado o Ejecutado, ver capítulo 9).</p>
${fig("ficha-hh", "Pestaña HH.")}

<h2>6.4 Fotos</h2>
<p>Muestra las fotos agrupadas: las de cada ítem de repuesto y las generales. Para agregar, elija en la lista si la foto es "Foto general del trabajo" o de un ítem, y pulse <b>Agregar fotos</b> o pegue con Ctrl+V. Clic en una foto para verla en grande. Solo el administrador puede borrar fotos.</p>
${fig("ficha-fotos", "Pestaña Fotos.")}

<h2>6.5 Bitácora</h2>
<p>Registra cada cambio de estado con fecha, hora y usuario. Escriba en el cuadro de abajo y pulse <b>Comentar</b> para dejar avances, coordinaciones u observaciones.</p>
${fig("ficha-bitacora", "Bitácora con el registro y un comentario.")}

<h2>6.6 Imprimir formato</h2>
<p>El botón <b>Imprimir formato</b> genera el formato "Mantenimiento correctivo programado" en A4 con el logo de Dimelco: datos del equipo, repuestos, HH, justificación y las firmas de Reportado por y Aprobado por. Si hay fotos, van en una segunda hoja. En la PC se guarda como PDF (la app pregunta dónde); en el celular o el navegador, use "Guardar como PDF" en la ventana de impresión.</p>
${fig("formato-impreso", "Formato impreso del ejemplo, con la hoja de imágenes.", "alta")}

<h2>6.7 Borrar un backlog</h2>
<p>Use <b>Borrar</b> solo si el backlog se registró por error (duplicado, equipo equivocado). La app pide el <b>motivo</b>; sin motivo no deja borrar. Un backlog Validado no lo puede borrar el capturador.</p>
${fig("borrar-dialogo", "Borrar pide el motivo.")}
<div class="alerta">El backlog borrado desaparece de todas las pantallas, los indicadores y los reportes. No se pierde: el administrador lo ve en "Backlogs borrados" con el motivo, quién y cuándo, y puede restaurarlo. Si el trabajo ya no procede por otra razón (el equipo se dio de baja, otra área lo resolvió), <b>anúlelo</b> con motivo en lugar de borrarlo (capítulo 7): así queda en el historial.</div>

<h1>7. Avanzar y retroceder el backlog</h1>
<p>Los botones de la derecha, en la cabecera de la ficha, son las acciones posibles en el estado actual. Los botones amarillos avanzan, los de borde gris devuelven un paso atrás y los rojos son para rechazar, anular o borrar. Cada cambio pide confirmación en un cuadro y queda en la bitácora con fecha, hora y usuario.</p>
${fig("estados-acciones", "Acciones de un backlog Identificado: Aprobar y planificar, Rechazar, Anular, además de Imprimir formato y Borrar.")}
<table>
  <tr><th>Estado actual</th><th>Avanzar</th><th>Paso atrás (pide motivo)</th><th>Otros (piden motivo)</th></tr>
  <tr><td>Identificado</td><td>Aprobar y planificar</td><td>-</td><td>Rechazar, Anular</td></tr>
  <tr><td>En planificación</td><td>Pasar a esperar repuestos; Listo para programar</td><td>Volver a Identificado</td><td>Anular</td></tr>
  <tr><td>Esperando repuestos</td><td>Listo para programar</td><td>Volver a planificación</td><td>Anular</td></tr>
  <tr><td>Listo para programar</td><td>Programar</td><td>Volver a planificación</td><td>Anular</td></tr>
  <tr><td>Programado</td><td>Marcar ejecutado; Reprogramar</td><td>Quitar del calendario</td><td>Anular</td></tr>
  <tr><td>Ejecutado</td><td>Validar</td><td>Volver a programado</td><td>-</td></tr>
  <tr><td>Validado, Rechazado, Anulado</td><td colspan="3">Bloqueado para el capturador. Solo el administrador lo revierte o lo borra.</td></tr>
</table>

<h2>7.1 Aprobar y planificar</h2>
<p>Pasa el backlog de Identificado a En planificación. El cuadro pide confirmar la <b>prioridad</b>; si cambia, la fecha límite se recalcula. Necesita al menos una especialidad con HH estimadas.</p>
${fig("estados-aprobar", "Aprobar y planificar: confirmar la prioridad.")}

<h2>7.2 Esperar repuestos y listo para programar</h2>
<p>Si hay repuestos sin recibir, use <b>Pasar a esperar repuestos</b>. Cuando llegan, márquelos como Recibido en la pestaña Repuestos: al recibir el último, el backlog pasa solo a <b>Listo para programar</b>. Si el trabajo no lleva repuestos, use directamente <b>Listo para programar</b>.</p>

<h2>7.3 Programar</h2>
<p>Desde Listo para programar, pulse <b>Programar</b> y complete:</p>
<ol>
  <li><span class="paso">1</span><b>Fecha programada</b>: el día del trabajo (no puede ser pasada).</li>
  <li><span class="paso">2</span><b>OT SAP</b> en HEMCO, o <b>N° OT</b> en las demás unidades (obligatorio).</li>
  <li><span class="paso">3</span>Marque <b>Aprovechar la parada de un PM</b> si se hará junto con un preventivo.</li>
</ol>
${fig("estados-programar", "Programar: fecha, número de OT y si aprovecha un PM.")}
<p>También se programa arrastrando la tarjeta desde "Listos para programar" hasta el día en el <b>Calendario</b> (8.3).</p>

<h2>7.4 Reprogramar o quitar del calendario</h2>
<p><b>Reprogramar</b> cambia la fecha de un backlog Programado: pide la fecha nueva y el motivo, mantiene la OT y suma una reprogramación. En el calendario se hace arrastrando la tarjeta a otro día. <b>Quitar del calendario</b> lo devuelve a Listo para programar, también con motivo.</p>
${fig("estados-reprogramar", "Reprogramar: fecha nueva y motivo.")}

<h2>7.5 Volver un paso atrás</h2>
<p>Si algo cambió (falta información, cambió la prioridad de producción, el trabajo quedó mal hecho), use el botón de paso atrás del estado actual. El cuadro pide el <b>motivo</b>; en la bitácora queda como "Retroceso" con ese motivo.</p>
${fig("estados-retroceso", "Volver a Identificado con motivo.")}
<div class="ejemplo">Un trabajo marcado como Ejecutado quedó con fuga: pulse <b>Volver a programado</b> con el motivo "Quedó una fuga, se repite". Se borra la fecha de ejecución y se mantienen la fecha programada y la OT.</div>

<h2>7.6 Rechazar y anular</h2>
<p><b>Rechazar</b> (desde Identificado) es para una necesidad que no procede. <b>Anular</b> (en cualquier estado abierto) es para un trabajo que ya no se hará: equipo dado de baja, otra área lo resolvió. Los dos piden motivo y dejan el backlog bloqueado; si hay que retomarlo, el administrador lo reabre.</p>

<h1>8. Seguir los backlogs</h1>
<h2>8.1 Kanban</h2>
<p>Muestra los backlogs en cinco columnas, una por etapa. Cada tarjeta tiene folio, prioridad, tipo de pedido, equipo, trabajo, HH, días desde la detección, repuestos recibidos y, si corresponde, "vencido" en rojo. Arriba hay filtros por texto (folio, equipo, trabajo, OT), familia, prioridad y tipo de pedido.</p>
<p>En la PC, arrastre una tarjeta a otra columna para cambiarla de etapa: la app abre el mismo cuadro que el botón de la ficha (por ejemplo, al soltarla en Programado pide fecha y OT). Si el cambio no es posible desde ese estado, la tarjeta no se suelta.</p>
${fig("kanban", "Kanban de la unidad.")}
<p>Clic en una tarjeta para desplegarla: muestra equipo, sistema, horómetro, quién reportó y aprobó, repuestos, especialidades y justificación, con un enlace a la ficha.</p>
${fig("kanban-tarjeta", "Tarjeta desplegada.")}

<h2>8.2 Por equipo</h2>
<p>Clic en un equipo para ver sus backlogs abiertos. <b>Historial del equipo</b> abre todos sus backlogs, abiertos y cerrados, con las HH por sistema. Use los filtros de arriba para buscar un equipo, ver una familia o solo los equipos con vencidos.</p>
${fig("por-equipo-desplegado", "Equipo PS011 desplegado con su backlog.")}

<h2>8.3 Calendario</h2>
<p>Muestra la semana de lunes a domingo con los trabajos programados por equipo y día, y abajo las barras de HH programadas contra la capacidad del taller por especialidad. Para programar, arrastre una tarjeta desde "Listos para programar" hasta el día (pide la OT); para reprogramar, arrastre la tarjeta programada a otro día (pide el motivo). Use las flechas para cambiar de semana y <b>Hoy</b> para volver a la actual.</p>
${fig("calendario", "Calendario semanal.")}

<h1>9. Cerrar un trabajo: ejecutar y validar</h1>
<p>Cuando se termina un trabajo que estaba <b>Programado</b>, el capturador lo cierra así:</p>
<ol>
  <li><span class="paso">1</span>Abra la ficha del backlog (desde el Kanban, columna Programado, o desde el calendario).</li>
  <li><span class="paso">2</span>Vaya a la pestaña <b>HH</b>. En <b>HH reales</b>, elija la especialidad, escriba personas y horas trabajadas de verdad, y pulse <b>Agregar</b>. Repita por cada especialidad.</li>
</ol>
${fig("ejecutar-hh-reales", "Carga de HH reales: 2 mecánicos × 3,5 horas.")}
<ol start="3">
  <li><span class="paso">3</span>Pulse <b>Marcar ejecutado</b>. En el cuadro, confirme la <b>fecha de ejecución</b> (por defecto hoy) y escriba un comentario con lo que se hizo.</li>
  <li><span class="paso">4</span>Pulse <b>Marcar ejecutado</b> en el cuadro para confirmar.</li>
</ol>
${fig("ejecutar-dialogo", "Cuadro Marcar ejecutado con fecha y comentario.")}
<p>El backlog pasa a <b>Ejecutado</b>.</p>
${fig("ejecutar-resultado", "Backlog en estado Ejecutado.")}
<div class="nota">Cargue las HH reales antes de marcar ejecutado: con ellas se compara lo estimado con lo real en los indicadores y en el reporte semanal.</div>
<h2>9.1 Validar</h2>
<p>Revise que el trabajo quedó bien (prueba del equipo, HH reales, repuestos usados) y pulse <b>Validar</b>. El cuadro avisa que después ya no se podrá cambiar.</p>
${fig("validar-dialogo", "Validar: el cuadro avisa que el backlog quedará bloqueado.")}
<p>Un backlog validado muestra la barra completa (5 de 5) y, para el capturador, solo el botón Imprimir formato. Si hay que corregir algo, pida al administrador que lo revierta a Ejecutado.</p>
${fig("validado-bloqueado", "Backlog validado: bloqueado para el capturador.")}

<h1>10. Indicadores y reporte semanal</h1>
<p>La pantalla <b>Indicadores</b> muestra, para su unidad:</p>
<ul>
  <li>backlogs abiertos, <b>HH acumuladas pendientes</b>, semanas de backlog (cuando hay capacidad cargada), vencidos, HH ya programadas y cerrados dentro del plazo;</li>
  <li>HH acumuladas por especialidad;</li>
  <li>antigüedad de los abiertos (0 a 15, 16 a 30, 31 a 60 y más de 60 días);</li>
  <li>vencidos por prioridad;</li>
  <li>ingresos contra cierres por semana en las últimas 12 semanas.</li>
</ul>
<p>Botones: <b>Reporte semanal PDF</b> (el mismo reporte que llega por correo los lunes) y <b>Exportar abiertos a Excel</b>.</p>
${fig("indicadores", "Indicadores.")}

<h1>11. Capacidad del taller</h1>
<p>Indica cuántas HH por semana hay disponibles para backlog en cada especialidad de su unidad. Con ella se calculan las semanas de backlog y las barras del calendario.</p>
<ol>
  <li><span class="paso">1</span>Pulse <b>Cambiar</b> en la especialidad.</li>
  <li><span class="paso">2</span>Use la calculadora: <b>personas × horas efectivas por turno × turnos por semana</b>. La app llena las HH por semana; también puede escribirlas directo.</li>
  <li><span class="paso">3</span>Elija desde qué fecha rige (por defecto hoy) y pulse <b>Grabar</b>.</li>
</ol>
<div class="ejemplo">3 mecánicos × 10 horas efectivas × 2 turnos por semana = 60 HH por semana.</div>
${fig("capacidad", "Calculadora de capacidad para Mecánico.")}
<p>Cada cambio queda en el historial con su fecha; los indicadores de semanas anteriores no cambian.</p>

<h1>12. Uso desde el celular</h1>
<p>En el celular el menú pasa a una barra abajo: <b>Nuevo</b>, <b>Por equipo</b>, <b>Kanban</b> y <b>Más</b> (resto del menú, unidad, cambiar contraseña y cerrar sesión). El Kanban se recorre por etapas con las pestañas de arriba y se avanza con los botones dentro de cada tarjeta. En Fotos, el botón ofrece tomar la foto con la cámara.</p>
${movil([["movil-inicio", "Por equipo en el celular."], ["movil-nuevo", "Nuevo backlog en el celular."]])}
${movil([["movil-kanban", "Kanban en el celular."], ["movil-ficha", "Ficha en el celular."]])}

<h1>13. Preguntas frecuentes y mensajes de la app</h1>
<table>
  <tr><th>Situación o mensaje</th><th>Qué significa y qué hacer</th></tr>
  <tr><td>El botón Registrar backlog está gris</td><td>Falta un dato obligatorio. Lea el texto "Falta: ..." junto al botón.</td></tr>
  <tr><td>No encuentro el equipo en la lista</td><td>El equipo está inactivo o es de una unidad que no tiene asignada. Pida al administrador que lo active o le asigne la unidad.</td></tr>
  <tr><td>El sistema que necesito no está en la lista</td><td>Elija <b>Otro</b> y escriba cuál. Avise al administrador para que lo agregue a la familia del equipo.</td></tr>
  <tr><td>"Cada repuesto necesita número de parte o código, y cantidad"</td><td>Complete el número de parte (o código SAP en HEMCO) y la cantidad, o quite la fila vacía con la ×.</td></tr>
  <tr><td>"Indique quién reporta la necesidad y quién la aprueba"</td><td>Complete Reportado por y Aprobado por.</td></tr>
  <tr><td>"La fecha de detección no puede ser futura"</td><td>Corrija la fecha.</td></tr>
  <tr><td>No puedo cambiar los datos del backlog</td><td>Está Validado, Rechazado o Anulado. Pida al administrador que lo revierta si hace falta corregirlo.</td></tr>
  <tr><td>"Indique el motivo para volver a ..."</td><td>Todo paso atrás pide motivo. Escríbalo en el cuadro.</td></tr>
  <tr><td>"Faltan N repuesto(s) por recibir"</td><td>Para pasar a Listo para programar, marque como Recibido los repuestos en la pestaña Repuestos, o use Pasar a esperar repuestos.</td></tr>
  <tr><td>"Para programar indique fecha programada y N° de OT"</td><td>Complete la fecha y el número de OT en el cuadro Programar.</td></tr>
  <tr><td>"El backlog está ...: solo el administrador puede revertirlo"</td><td>El backlog está cerrado (Validado, Rechazado o Anulado). Pida al administrador que lo revierta.</td></tr>
  <tr><td>"Las HH reales se cargan con el backlog Programado o Ejecutado"</td><td>Todavía no está programado. Las HH reales se cargan al terminar el trabajo.</td></tr>
  <tr><td>No veo un botón que esperaba</td><td>Cada estado muestra solo sus acciones (tabla del capítulo 7). Por ejemplo, Programar aparece en Listo para programar y Validar en Ejecutado.</td></tr>
  <tr><td>"El backlog está borrado: no se edita"</td><td>Alguien lo borró. Pida al administrador que lo restaure si hace falta.</td></tr>
  <tr><td>Abajo dice "Sin conexión" o "Reconectando"</td><td>Revise el internet. Lo que esté escrito y no grabado se pierde si cierra la app.</td></tr>
  <tr><td>Olvidé la contraseña</td><td>Pida al administrador que la restablezca desde la pantalla Usuarios.</td></tr>
  <tr><td>Registré un backlog dos veces</td><td>Borre el duplicado con el motivo "Duplicado de BL-..." (6.7) o anúlelo.</td></tr>
</table>

<h1>14. Resumen: qué puede y qué no puede hacer el capturador</h1>
<table>
  <tr><th>Acción</th><th>Capturador</th><th>Administrador</th></tr>
  <tr><td>Registrar backlogs de sus unidades</td><td>Sí</td><td>Sí, en todas</td></tr>
  <tr><td>Corregir datos del backlog</td><td>Mientras esté abierto (hasta Ejecutado)</td><td>Mientras esté abierto</td></tr>
  <tr><td>Repuestos, HH estimadas y fotos</td><td>Mientras esté abierto</td><td>Sí</td></tr>
  <tr><td>Borrar fotos</td><td>No</td><td>Sí</td></tr>
  <tr><td>Comentar en la bitácora</td><td>Sí</td><td>Sí</td></tr>
  <tr><td>Aprobar, esperar repuestos, programar, reprogramar</td><td>Sí</td><td>Sí</td></tr>
  <tr><td>Volver un paso atrás (con motivo)</td><td>Sí, hasta Ejecutado</td><td>Sí</td></tr>
  <tr><td>Cargar HH reales y marcar ejecutado</td><td>Sí</td><td>Sí</td></tr>
  <tr><td>Validar</td><td>Sí</td><td>Sí</td></tr>
  <tr><td>Rechazar y anular (con motivo)</td><td>Sí</td><td>Sí</td></tr>
  <tr><td>Revertir un Validado; reabrir un Rechazado o Anulado</td><td>No</td><td>Sí</td></tr>
  <tr><td>Borrar un backlog con motivo</td><td>Sí, salvo Validado</td><td>Sí, y también restaurarlo</td></tr>
  <tr><td>Capacidad del taller</td><td>Sí, en su unidad</td><td>Sí, en todas</td></tr>
  <tr><td>Indicadores, reporte PDF, Excel, formato impreso</td><td>Sí</td><td>Sí</td></tr>
  <tr><td>Equipos, familias, sistemas, plazos, usuarios</td><td>No</td><td>Sí</td></tr>
</table>
<p style="margin-top:14px">Dudas sobre la app: Samuel Zapata, administrador de Control de Backlog (samuel.e.zapata.t@gmail.com).</p>
</body></html>`;

writeFileSync(join(DIR, "manual_capturador.html"), html);
const navegador = await playwright.chromium.launch();
const p = await navegador.newPage();
await p.setContent(html, { waitUntil: "load" });
const salida = join(DIR, "Manual_capturador_Backlog_Dimelco.pdf");
await p.pdf({
  path: salida,
  format: "A4",
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: "<span></span>",
  footerTemplate:
    '<div style="width:100%;font:8px Segoe UI,Arial;color:#777;padding:0 15mm;display:flex;justify-content:space-between"><span>Control de Backlog · Manual del capturador</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
  margin: { top: "16mm", bottom: "16mm", left: "15mm", right: "15mm" },
});
await navegador.close();
console.log(`Manual: ${salida} (${nFig} figuras)`);
