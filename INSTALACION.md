# Puesta en marcha

Guía para dejar la app Control de Backlog en uso. Proyecto Supabase: `backlog-hemco` (https://sfrelyrpnnvqjpzkznnu.supabase.co). Es independiente del de preventivos: otros usuarios, otra base, otro instalador.

## 1. Base de datos

1. En el SQL Editor de backlog-hemco, pegar y ejecutar `tools/verificar_instalacion.sql`. Muestra 14 puntos con OK o FALTA y qué hacer en cada uno.
2. Si la base es nueva, ejecutar `supabase/instalar_todo.sql` completo. Si ya tenía las migraciones 001 a 007, ejecutar en orden solo las que la verificación marque: `008_formato_backlog.sql`, `009_reprogramar.sql`, `010_validado.sql`, `011_fotos.sql`, `012_recalcular_limites.sql`, `013_numero_formato.sql` (carpeta `supabase/migrations`). Todas se pueden repetir sin daño.
3. Edge Functions: la función `admin-usuarios` publicada (código en `supabase/functions/admin-usuarios/index.ts`). Sin ella la pantalla Usuarios no crea cuentas.
4. Volver a ejecutar `tools/verificar_instalacion.sql`: los puntos 1 a 9 deben quedar en OK.

## 2. Datos de arranque (en la app, con el usuario administrador)

| Pantalla | Qué cargar |
|---|---|
| Equipos | Revisar los equipos copiados de preventivos; completar la marca y la flota (Scoop, Jumbo, Camión...). Crear los que falten. |
| Sistemas y especialidades | Ajustar la lista a la de HEMCO. Lo que no se use se desactiva; no se borra. |
| Capacidad del taller | HH por semana de cada especialidad en cada unidad: personas × horas efectivas por turno × turnos por semana. |
| Plazos por prioridad | Días de atención de P1 a P4 (los iniciales son provisionales: 2, 7, 30 y 90). Después, "Recalcular abiertos". |
| Usuarios | Una cuenta por persona. Capturador e invitado llevan unidad; el administrador ve todas. |
| Importar backlogs | Backlogs que ya existen en el formato Excel "Mantenimiento correctivo programado": se eligen los archivos, se revisa la vista previa (equipo encontrado, repuestos, fotos), se elige el sistema y se importan como Identificado. El N° del formato queda como referencia y no se puede importar dos veces. |

Al terminar, `tools/verificar_instalacion.sql` debe dar OK en los 14 puntos.

## 3. Instalación en cada PC

Requisitos: Windows 10 u 11 con internet.

1. Descargar `Control-de-Backlog-Dimelco-Setup-x.x.x.exe` de Releases en https://github.com/Samuel270302/Backlog-Hemco/releases y ejecutarlo. Si Windows SmartScreen avisa, "Más información" y "Ejecutar de todas formas": el instalador no está firmado con certificado comercial.
2. La primera vez pide la URL del proyecto (`https://sfrelyrpnnvqjpzkznnu.supabase.co`) y la llave anon (Supabase, Project Settings, API Keys; es la llave pública, sin usuario y contraseña no da acceso a datos).
3. Entrar con correo y contraseña. Cada usuario cambia su contraseña inicial con "Cambiar contraseña" en el menú.

La app guarda sus datos locales en la carpeta "Backlog HEMCO"; puede convivir en el mismo PC con Control de Preventivos sin cruzar sesión ni conexión.

## 4. Primer recorrido de prueba

Con un backlog de prueba (se anula al final):

1. Nuevo backlog: equipo, descripción, un repuesto, una especialidad con HH y una foto. Imprimir formato: el PDF sale en A4 vertical con la foto en la hoja 2.
2. Kanban: arrastrar la tarjeta a Planeado (pide prioridad). Marcar el repuesto como recibido en la ficha: pasa solo a Listo para programar.
3. Calendario: arrastrar el backlog a un día; pide la OT. Revisar la barra de HH de la especialidad contra la capacidad.
4. Desde otro PC con otro usuario, comprobar que el cambio se ve en segundos (tiempo real).
5. Indicadores: generar el reporte semanal PDF y el Excel.
6. En la ficha, "Anular" con motivo "Prueba de puesta en marcha".

## Roles

| Rol | Puede |
|---|---|
| Administrador | Todo, en todas las unidades: aprobar, planificar, programar, reprogramar, validar, anular, borrar fotos y administrar catálogos, capacidad, plazos y usuarios. |
| Capturador | En su unidad: registrar backlogs, cargar HH, repuestos y fotos, comentar, editar mientras está Identificado y marcar Ejecutado. |
| Invitado | Consultar su unidad, imprimir y exportar. La base rechaza cualquier escritura. |

## Actualizaciones

La app busca versiones nuevas al abrir y cada 4 horas; las descarga sola y avisa para reiniciar. Para publicar una versión: subir el número en `package.json` (por ejemplo 0.2.0 a 0.2.1) y hacer push a `main`. El flujo "Instalador de Windows" arma el instalador y crea el release `vX.Y.Z`. Si el número no cambia, las PC no se actualizan.

## Respaldo y continuidad

El flujo "Mantenimiento de la base" (`.github/workflows/mantenimiento.yml`) consulta la base todos los días para que Supabase (plan Free) no pause el proyecto y guarda un respaldo cifrado en la rama `respaldos`. Necesita el secreto `SUPABASE_DB_URL` en Settings, Secrets and variables, Actions del repositorio. Las fotos de Storage no entran en ese respaldo.

## Pruebas

    tools/prueba_local.sh          base: migraciones, flujo de estados y permisos por rol y unidad
    tests/e2e.sh                   navegador: recorrido completo con capturador y administrador
    tests/e2e.sh electron.mjs      app de escritorio: sesión, foto, formato y reporte en PDF, Excel

Las tres levantan un PostgreSQL temporal y no tocan Supabase.
