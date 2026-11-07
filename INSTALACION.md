# Puesta en marcha

Guía para dejar la app Control de Backlog en uso. Proyecto Supabase: `backlog-hemco` (https://sfrelyrpnnvqjpzkznnu.supabase.co). Es independiente del de preventivos: otros usuarios, otra base, otro instalador.

## 1. Base de datos

1. En el SQL Editor de backlog-hemco, pegar y ejecutar `tools/verificar_instalacion.sql`. Muestra 14 puntos con OK o FALTA y qué hacer en cada uno.
2. Si la base es nueva, ejecutar `supabase/instalar_todo.sql` completo. Si ya tenía las migraciones 001 a 007, ejecutar en orden solo las que la verificación marque: `008_formato_backlog.sql`, `009_reprogramar.sql`, `010_validado.sql`, `011_fotos.sql`, `012_recalcular_limites.sql`, `013_numero_formato.sql`, `014_mejoras.sql`, `015_borrar.sql` (carpeta `supabase/migrations`). Todas se pueden repetir sin daño.
3. Edge Functions: la función `admin-usuarios` publicada (código en `supabase/functions/admin-usuarios/index.ts`). Sin ella la pantalla Usuarios no crea cuentas.
4. Volver a ejecutar `tools/verificar_instalacion.sql`: los puntos 1 a 9 deben quedar en OK.

## 2. Datos de arranque (en la app, con el usuario administrador)

| Pantalla | Qué cargar |
|---|---|
| Familias y sistemas | Familias de equipo (Scooptram ST1030, PowerROC T35...) y, para cada una, los sistemas que se ofrecen al registrar un backlog. «Otro» se ofrece siempre y pide escribir cuál. Especialidades (incluye Electromecánico). Lo que no se use se desactiva; no se borra. |
| Equipos | Revisar los equipos copiados de preventivos; asignar la familia y completar la marca. Crear los que falten. |
| Capacidad del taller | HH por semana de cada especialidad en cada unidad: personas × horas efectivas por turno × turnos por semana. |
| Plazos por prioridad | Niveles de criticidad de la OT de Dimelco: 1 Urgente (1 día, 24 horas), 2 Alto (3 días), 3 Medio (14 días), 4 Bajo (40 días). Si cambian, "Recalcular abiertos". |
| Usuarios | Una cuenta por persona. Capturador e invitado ven las unidades que se les marquen (una o varias); el administrador ve todas. |

Al terminar, `tools/verificar_instalacion.sql` debe dar OK en los 14 puntos.

## 3. Instalación en cada PC

Requisitos: Windows 10 u 11 con internet.

1. Descargar `Control-de-Backlog-Dimelco-Setup-x.x.x.exe` de Releases en https://github.com/Samuel270302/Backlog-Dimelco/releases y ejecutarlo. Si Windows SmartScreen avisa, "Más información" y "Ejecutar de todas formas": el instalador no está firmado con certificado comercial.
2. La primera vez pide la URL del proyecto (`https://sfrelyrpnnvqjpzkznnu.supabase.co`) y la llave anon (Supabase, Project Settings, API Keys; es la llave pública, sin usuario y contraseña no da acceso a datos).
3. Entrar con correo y contraseña. Cada usuario cambia su contraseña inicial con "Cambiar contraseña" en el menú.

La app guarda sus datos locales en la carpeta "Backlog HEMCO"; puede convivir en el mismo PC con Control de Preventivos sin cruzar sesión ni conexión.

## 4. Primer recorrido de prueba

Con un backlog de prueba (se anula al final):

1. Nuevo backlog: equipo (lista por familia), sistema, quién reporta y quién aprueba, descripción, un repuesto, una especialidad con HH y una foto (archivo o Ctrl+V). Imprimir formato: el PDF sale en A4 vertical con la foto en la hoja 2.
2. Kanban: arrastrar la tarjeta a Planeado (pide prioridad). Marcar el repuesto como recibido en la ficha: pasa solo a Listo para programar.
3. Calendario: arrastrar el backlog a un día; pide la OT. Revisar la barra de HH de la especialidad contra la capacidad.
4. Desde otro PC con otro usuario, comprobar que el cambio se ve en segundos (tiempo real).
5. Indicadores: generar el reporte semanal PDF y el Excel.
6. En la ficha, "Anular" con motivo "Prueba de puesta en marcha".

## Versión web para celular

Dirección: https://samuel270302.github.io/Backlog-Dimelco/ (mismo usuario y contraseña que la app de escritorio). Se publica sola con cada cambio en `main` (flujo "Web para celular"). La URL del proyecto ya está en el flujo; solo falta la llave anon.

En el celular: barra inferior con Por equipo, Kanban, Calendario (Nuevo para capturadores) y Más (resto del menú, unidad, contraseña y cerrar sesión). El Kanban se desliza por etapas y se avanza con los botones de cada tarjeta (no se arrastra). El calendario se ve por día; programar y reprogramar se hacen desde la ficha. El formato y el reporte se imprimen con "Guardar como PDF" del navegador. En Android (Chrome) y en iPhone (Safari, Compartir) se puede "Agregar a pantalla de inicio": es un acceso directo a la misma página, siempre en línea.

## Reporte semanal por correo

Cada lunes a las 6:03 a. m. (hora de Nicaragua) el flujo "Reporte semanal por correo" envía, desde y hacia samuel.e.zapata.t@gmail.com (se cambian en `.github/workflows/reporte_semanal.yml`), un correo con todas las unidades: las cifras en el cuerpo (abiertos, HH pendientes, semanas de backlog, vencidos, HH programadas y cerrados en 7 días, por unidad y total), el PDF del reporte semanal y un Excel con los backlogs abiertos, los cerrados de los últimos 7 días y las semanas de backlog. Solo falta la contraseña de aplicación de Gmail.

## Base de datos al día sola

El flujo "Actualizar base de datos" aplica en Supabase las migraciones del repositorio cada vez que cambian (con el secreto `SUPABASE_DB_URL`, en una sola transacción) y deja en su registro la tabla de `tools/verificar_instalacion.sql`. Ya no hace falta pegar migraciones en el SQL Editor.

## Lo único que queda por hacer a mano (una vez)

En GitHub, repositorio Samuel270302/Backlog-Dimelco:
1. Settings > Pages > Build and deployment > Source: **GitHub Actions**.
2. Settings > Secrets and variables > Actions > pestaña **Variables** > New repository variable: `SUPABASE_ANON_KEY` = la llave anon (Supabase > Project Settings > API Keys; la "anon public" o la "publishable"). Nunca la service_role ni la secret.
3. En Gmail (samuel.e.zapata.t@gmail.com): con la verificación en dos pasos activa, crear una contraseña de aplicación en https://myaccount.google.com/apppasswords (nombre: "Backlog"). Son 16 letras.
4. Settings > Secrets and variables > Actions > pestaña **Secrets** > New repository secret: `CORREO_CLAVE_APP` = esas 16 letras.
5. Actions > "Web para celular" > Run workflow, y Actions > "Reporte semanal por correo" > Run workflow (prueba: llega el correo en un par de minutos).

Prompt para que Claude in Chrome haga los clics (se detiene para que tú pegues la llave y la contraseña):

    Haz en el navegador, en orden, y confírmame cada paso. Nunca escribas llaves ni contraseñas: detente y déjame pegarlas.
    1. En https://github.com/Samuel270302/Backlog-Dimelco/settings/pages pon "Source" en "GitHub Actions".
    2. En https://supabase.com/dashboard abre el proyecto backlog-hemco > Project Settings > API Keys y muéstrame dónde está la llave "anon public" (o "publishable"). No la copies.
    3. En https://github.com/Samuel270302/Backlog-Dimelco/settings/variables/actions crea la variable SUPABASE_ANON_KEY y detente para que yo pegue el valor.
    4. Abre https://myaccount.google.com/apppasswords con la cuenta samuel.e.zapata.t@gmail.com, crea una contraseña de aplicación llamada "Backlog" y detente: yo la copio.
    5. En https://github.com/Samuel270302/Backlog-Dimelco/settings/secrets/actions crea el secreto CORREO_CLAVE_APP y detente para que yo pegue la contraseña.
    6. En https://github.com/Samuel270302/Backlog-Dimelco/actions ejecuta "Web para celular" y "Reporte semanal por correo" (Run workflow) y dime si terminan en verde.

## Copiar los usuarios de preventivos

Para tener en backlog las mismas cuentas de preventivos, con la misma contraseña, el mismo rol y la misma unidad:
1. En el SQL Editor del proyecto de **preventivos** (ltgsfgcmznausdotbyqk) ejecutar `tools/exportar_usuarios_preventivos.sql`. Solo lee. El resultado es una única celda de texto.
2. Copiar esa celda completa y ejecutarla en el SQL Editor de **backlog-hemco**. Trae las contraseñas cifradas: pegarla solo ahí y no compartirla. Se puede repetir sin duplicar usuarios.
3. Ejecutar al final de esa misma consulta la tabla que trae (nombre, correo, rol, activo, unidad) y compararla con la pantalla Usuarios de preventivos.

Un usuario nuevo de preventivos que se cree después no pasa solo: se repite el procedimiento o se crea en la pantalla Usuarios de backlog.

## Borrar backlogs

En la ficha, "Borrar" (administrador y capturador de la unidad, en cualquier estado) pide el motivo. El backlog deja de verse en todas las pantallas, indicadores, reportes y el correo semanal, pero no se elimina: el administrador lo ve en Administración > Backlogs borrados (folio, estado que tenía, quién, cuándo y motivo) y lo puede restaurar. El folio no se vuelve a usar.

## SAP

Solo HEMCO usa SAP (`unidades.usa_sap`). En Veta Nueva, Mina La India y Explotec no aparecen Aviso SAP, Código SAP ni SolPed, y la orden se pide como "N° OT".

## Roles

| Rol | Puede |
|---|---|
| Administrador | Todo, en todas las unidades. Además de lo del capturador: revertir un backlog Validado, reabrir uno Rechazado o Anulado, borrar cualquiera y restaurarlo, borrar fotos y administrar familias, sistemas, equipos, capacidad, plazos y usuarios. |
| Capturador | En sus unidades (las marcadas en Usuarios): registrar y editar backlogs abiertos; avanzar y retroceder estados con motivo (aprobar, esperar repuestos, programar, reprogramar, ejecutar, validar, rechazar, anular); cargar HH, repuestos y fotos; comentar; editar la capacidad del taller y borrar backlogs con motivo. Un backlog Validado, Rechazado o Anulado queda bloqueado para el capturador. |
| Invitado | Consultar sus unidades (las marcadas en Usuarios), imprimir y exportar. La base rechaza cualquier escritura. |

## Actualizaciones

La app busca versiones nuevas al abrir y cada 4 horas; las descarga sola y avisa para reiniciar. Para publicar una versión: subir el número en `package.json` (por ejemplo 0.2.0 a 0.2.1) y hacer push a `main`. El flujo "Instalador de Windows" arma el instalador y crea el release `vX.Y.Z`. Si el número no cambia, las PC no se actualizan.

## Respaldo y continuidad

El flujo "Mantenimiento de la base" (`.github/workflows/mantenimiento.yml`) consulta la base todos los días para que Supabase (plan Free) no pause el proyecto y guarda un respaldo cifrado en la rama `respaldos`. Necesita el secreto `SUPABASE_DB_URL` en Settings, Secrets and variables, Actions del repositorio. Las fotos de Storage no entran en ese respaldo.

## Pruebas

    tools/prueba_local.sh          base: migraciones, flujo de estados y permisos por rol y unidad
    tests/e2e.sh                   navegador: recorrido completo con capturador y administrador
    tests/e2e.sh electron.mjs      app de escritorio: sesión, foto, formato y reporte en PDF, Excel
    tests/e2e.sh movil.mjs         sitio web en pantalla de celular
    SIN_BUILD=1 tests/e2e.sh reporte_correo.mjs   reporte semanal por correo (sin enviar)
    tests/copiar_usuarios.sh       copia de usuarios de preventivos con dos bases locales

Las tres levantan un PostgreSQL temporal y no tocan Supabase.
