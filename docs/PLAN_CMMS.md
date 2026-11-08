# Plan de fusión: CMMS Dimelco (preventivos + backlog + órdenes de trabajo)

Documento de planificación, 08/11/2026 (revisado el mismo día: la base del CMMS es el proyecto de backlog). Base: Control de Preventivos 0.6.0 (repositorio Control-de-preventivos-Dimelco) y Control de Backlog 0.5.5 (repositorio Backlog-Dimelco). El código del CMMS está en el repositorio CMMS-Dimelco. El mismo archivo está en `docs/PLAN_CMMS.md` de los tres repositorios.

## Punto de partida

Las dos apps tienen la misma tecnología (Electron 33 + React 18 + TypeScript + Supabase, versión web en GitHub Pages, instalador NSIS, respaldo diario cifrado en la rama `respaldos`, reporte semanal por Gmail) y la misma forma de seguridad (roles admin, capturador e invitado; varias unidades por usuario desde la migración 017 de cada una). La diferencia está en los datos: cada una tiene su propio proyecto Supabase.

| Tema | Preventivos 0.6.0 | Backlog 0.5.5 |
|---|---|---|
| Proyecto Supabase | propio | propio |
| Tablas propias | planes_mp, componentes, lecturas, registros_pm, cambios_horometro, registros_manuales, columnas_control | backlogs, folios, backlog_hh, backlog_repuestos, backlog_eventos, backlog_fotos, sistemas, familias, familia_sistemas, especialidades, capacidad_taller |
| Tablas con el mismo nombre | unidades, perfiles, parametros, equipos | unidades, perfiles, parametros, equipos |
| Cálculo | vistas v_control_pm, v_control_40, v_cumplimiento_pm, v_utilizacion_mensual | vistas v_backlog, v_carga_semanal, v_semanas_backlog, v_hh_pendiente |
| Programación | pantalla Programa: proyección de 4 semanas a partir de v_control_pm y v_control_40, sin OT | Calendario y Capacidad: backlog Programado por semana contra HH del taller; campo `ot_sap` en texto |
| Archivos | sin Storage | bucket `backlog-fotos`, ruta `<unidad_id>/<backlog_id>/<archivo>.jpg` |

Hechos que facilitan la fusión:

1. Los equipos de backlog se copiaron desde preventivos (`tools/importar_equipos.py` y `tools/exportar_equipos_preventivos.sql`), con la misma clave natural: unidad + `cod_interno` (restricción `equipos_unidad_cod_interno_key` en las dos bases).
2. Los usuarios de backlog se copiaron desde preventivos con `tools/exportar_usuarios_preventivos.sql`, que copia `auth.users` con el mismo `id`. Los `user_id` de perfiles coinciden en las dos bases para esos usuarios.
3. Las cuatro unidades tienen el mismo nombre en las dos bases (HEMCO, Veta Nueva, Mina La India, Explotec); backlog agrega la columna `sigla`.
4. Las claves de `parametros` no chocan: solo `fecha_referencia` está en las dos, con el mismo uso.
5. La Edge Function `admin-usuarios` de preventivos acepta `unidades` (0.6.0) y `unidad_id` (versiones anteriores), así que la app de backlog 0.5.5 puede usarla sin cambios.

## Decisión de arquitectura

### Una sola base: el proyecto Supabase de backlog

La base del CMMS es el proyecto de backlog (decisión del 08/11/2026), ampliado con las tablas de preventivos y, después, con las de órdenes de trabajo. Lo que tiene ese proyecto y no hay que mover: unidades con sigla, familias y sistemas por familia, el bucket `backlog-fotos` con sus fotos y los folios BL-xxx. Lo que se mueve es lo de preventivos: equipos que falten, componentes, planes MP, lecturas por turno, registros PM y cambios de horómetro.

La copia de datos a producción se hace al final y solo con la aprobación del dueño, porque hay usuarios cargando información en las dos apps. Hasta entonces el CMMS se prueba con bases locales.

### Una app nueva al lado de las actuales

La app nueva es "CMMS Dimelco", en el repositorio CMMS-Dimelco. Se armó desde el código de backlog 0.5.5, que ya calza con esta base, y se le sumaron las 12 pantallas de preventivos 0.6.0. Tiene `appId` propio (`com.hemco.cmms`), carpeta de datos propia ("CMMS Dimelco") y su propio instalador y sitio web, así que se instala en el mismo PC sin tocar las otras dos.

Las apps actuales quedan habilitadas:

- Control de Backlog sigue igual: misma base, mismo instalador, mismo sitio.
- Control de Preventivos sigue con su base hasta la fusión. Al fusionar, solo cambia la conexión: en escritorio, el admin pone en la pantalla de configuración de cada PC la URL y la llave anon del proyecto de backlog; en web, se cambian la URL y la llave anon en `.github/workflows/web.yml` de ese repositorio y el sitio se vuelve a publicar. No hay que cambiar código: la prueba `tests/compat_preventivos.mjs` del CMMS corre la app 0.6.0 tal como está contra la base del CMMS.

Después de la fusión, las tres apps leen y graban en la misma base: una lectura capturada en la app vieja de preventivos aparece en el CMMS y al revés. No hay copias que sincronizar. Las apps viejas se pueden retirar cuando se decida, sin migración adicional.

## Modelo de datos fusionado

### Tablas compartidas: cómo se reconcilian

| Objeto | Backlog (base) | Preventivos | Resultado en la base del CMMS |
|---|---|---|---|
| unidades | id, nombre, sigla, usa_sap | id, nombre | quedan las de backlog; las de preventivos se cruzan por nombre |
| perfiles | rol, activo, unidad_id, unidades[] | igual | quedan los de backlog; los usuarios que solo están en preventivos se copian con su cuenta (misma contraseña) y su perfil; si un usuario está en las dos con rol o unidades distintos, queda el de backlog y la diferencia se lista |
| parametros | plazos P1 a P4 | claves de horómetro y tendencia | se agregan las claves de preventivos con sus valores de producción |
| equipos | flota, familia_id, marca | fecha_inicio_operacion, creado_por | se agregan `fecha_inicio_operacion` y `creado_por`; los equipos de preventivos se cruzan por unidad + cod_interno y conservan los datos de backlog; los que solo existen en preventivos se crean y quedan sin familia para que el admin la asigne |
| funciones de sesión y unidad | rol_actual, unidad_actual, unidades_actuales, unidad_permitida, usuario_sesion, crear_perfil | las mismas con `auth.uid()` | quedan las de backlog (`usuario_sesion()` da lo mismo que `auth.uid()` en Supabase) |
| admin-usuarios (Edge Function) | solo `unidad_id` | acepta `unidades` y `unidad_id` | se publica la de preventivos, que sirve a las tres apps |
| políticas RLS | las de backlog | | las de backlog en las tablas compartidas; las de preventivos (002, 004, 015) en sus tablas |

### Tablas que entran sin cambios

De preventivos (migración `019_preventivos.sql` del CMMS): planes_mp, componentes, lecturas, registros_pm, cambios_horometro, registros_manuales y columnas_control, con las vistas v_lecturas, v_registros_pm, v_ultima_lectura, v_control_pm, v_control_40, v_cumplimiento_pm y v_utilizacion_mensual, las validaciones `validar_lectura` y `validar_registro_pm` y la auditoría de anulaciones. Se conservan los `id`.

De backlog: todo lo que ya está (migraciones 001 a 018), sin tocar.

### Tablas nuevas para órdenes de trabajo

| Tabla | Contenido |
|---|---|
| ordenes_trabajo | folio `OT-HEM-000001` por unidad, tipo (Preventiva, Rutina 40 h, Correctiva programada, Correctiva de emergencia, Mejora), equipo, componente (opcional, para las preventivas), plan y gama, prioridad, estado, fecha y turno programados, duración estimada, fecha de inicio y término reales, lectura de horómetro al ejecutar, aviso SAP, OT SAP, responsable, motivo de anulación |
| ot_backlogs | backlogs que se ejecutan en la OT (uno o varios; el caso "aprovechar PM" que hoy es un campo sí/no) |
| ot_tareas | lista de tareas de la OT, copiada de la pauta de la gama al crearla, con marca de hecho y observación |
| ot_hh | HH estimadas y reales por especialidad (misma forma que backlog_hh) |
| ot_repuestos | repuestos y kits SAP (misma forma que backlog_repuestos) |
| ot_eventos | bitácora de estados, reprogramaciones y comentarios |
| ot_fotos | fotos de la OT en Storage, ruta `<unidad_id>/ot/<ot_id>/<archivo>.jpg` |
| pautas_gama | tareas estándar y HH estándar por especialidad para cada plan_mp + gama |
| folios_ot | correlativo de OT por unidad |

Estados de OT, validados en la base con una función `cambiar_estado_ot()` como ya se hace con backlog:

    Creada -> Planificada -> Programada -> En ejecución -> Ejecutada -> Cerrada
    Programada -> Programada (reprogramación con fecha nueva y motivo, mismo folio)
    Cualquier estado abierto -> Anulada (con motivo)

### Cómo se generan y cierran las OT

- Preventiva y Rutina 40 h: el CMMS propone las OT a partir de `v_control_pm` y `v_control_40`; aparecen como sugeridas cuando la fecha estimada entra en la ventana `dias_programar` del plan (hoy es el estado "Programar" de Control PM). El planificador las confirma una por una o en lote; la OT toma el plan, la gama siguiente del ciclo, las tareas y HH de `pautas_gama` y los kits de `planes_mp.kits_sap`.
- Correctiva programada: se crea desde uno o varios backlogs en "Listo para programar" del mismo equipo. Al programar la OT, los backlogs pasan a Programado con la misma semana y fecha.
- Correctiva de emergencia: se crea directo, sin backlog previo, y al cerrarla puede dejar un backlog nuevo si el trabajo quedó pendiente.
- Al cerrar una preventiva, la base inserta el registro en `registros_pm` (fecha, gama, lectura, responsable) por la misma validación `validar_registro_pm` que usa hoy la pantalla Registro PM, y Control PM recalcula el próximo PM. Al cerrar una correctiva, los backlogs ligados pasan a Ejecutado con `cambiar_estado_backlog()`.
- Si en una OT se encuentra un hallazgo, se registra ahí mismo como backlog nuevo con origen "PM" (u otro) y la OT de origen.

## Traer la información de las dos apps

Lo de backlog ya está en la base del CMMS. Lo que se mueve es lo de preventivos, con `tools/traer_preventivos.mjs`. El procedimiento paso a paso está en `docs/FUSION.md` del repositorio CMMS-Dimelco y no se ejecuta sin aprobación.

1. Esquema: el flujo "Actualizar base de datos" del repositorio CMMS-Dimelco aplica `supabase/instalar_todo.sql` (backlog 001 a 018, que ya están, preventivo 019 y órdenes de trabajo 020). Solo agrega tablas, columnas y vistas; no cambia los datos de backlog. Se corre a mano y pide escribir APLICAR.
2. Ensayo sobre producción: el flujo "Traer datos de preventivos" en modo ensayo hace toda la copia y la verificación dentro de una transacción y la deshace. Muestra conteos, equipos que no cruzan y usuarios con perfiles distintos.
3. Ventana sin captura en preventivos, respaldo de las dos bases y el mismo flujo en modo grabar (pide escribir GRABAR). Confirma solo si la verificación sale sin diferencias.
4. Verificación incluida en la herramienta: los mismos conteos de planes, componentes, lecturas, registros PM, cambios de horómetro y registros manuales en las dos bases, y v_control_pm, v_control_40, v_cumplimiento_pm y v_utilizacion_mensual iguales fila por fila (con el id de equipo traducido).
5. Cambio de conexión de Control de Preventivos en cada PC y en la web.
6. El proyecto Supabase de preventivos queda sin uso por 30 días como respaldo (con su respaldo cifrado en la rama `respaldos`) y después se pausa.

El ensayo completo ya corre en bases locales con `tests/ensayo_traer_preventivos.sh` (también en GitHub Actions, flujo "Pruebas").

## Fases

| Fase | Contenido | Versión | Estado |
|---|---|---|---|
| 0 | Esquema 019, herramienta de copia y ensayo local | sin publicar | hecho el 08/11/2026 |
| 1 | App base: pantallas de las dos apps bajo un solo menú, un login, una ficha de equipo con pestañas Preventivo y Backlog | CMMS 0.1.0 | hecho el 08/11/2026 |
| 2 | Fusión de datos en producción (pasos 1 a 6 de arriba) | sin cambio de versión | espera aprobación |
| 3 | Órdenes de trabajo: programar (PM sugeridos desde Control PM y backlogs), mover, agrupar y anular | CMMS 0.2.0 | hecho el 08/11/2026 (migración 020) |
| 4 | Tablero de programación (ver abajo): preventivos y correctivos en una sola vista, con arrastrar y soltar y carga del taller | CMMS 0.2.0 | hecho el 08/11/2026, en el entorno de pruebas |
| 4b | Ejecución y cierre de la OT: HH reales, cierre que escribe registros_pm y deja los backlogs en Ejecutado, pauta de tareas por gama | CMMS 0.3.0 | pendiente |
| 5 | Indicadores de CMMS (ver propuestas) y reporte semanal único | CMMS 0.4.0 | pendiente |

Las fases 3, 4 y 4b se construyen y prueban antes de la fase 2, con bases locales. El tablero de la 0.2.0 programa; todavía no ejecuta ni cierra OT.

Menú del CMMS 0.1.0:

    Preventivo      Control PM, Rutina 40 h, Programa 4 semanas, Lecturas, Registro PM,
                    Cambios horómetro, Historial, Gráficas, Indicadores PM
    Backlog         Nuevo backlog, Por equipo, Kanban, Calendario, Indicadores backlog,
                    Capacidad del taller
    Administración  Equipos, Componentes y horómetros, Plan MP, Familias y sistemas,
                    Plazos por prioridad, Backlogs borrados, Usuarios

Con las fases 3 y 4 se agregan "Órdenes de trabajo" (Sugeridas, Abiertas, Nueva OT, Historial) y "Programación" (tablero semanal).

## Tablero de programación

Es el objetivo principal de juntar las dos apps: programar preventivos y correctivos en la misma vista, de forma visual.

- Filas: equipos de la unidad, agrupados por familia (Scooptram, Jumbo, Empernador...). Columnas: días de la semana, partidos en turno Día y Noche. Se puede cambiar a vista de 4 semanas.
- Columna lateral "Por programar" con dos grupos: PM sugeridos desde `v_control_pm` y `v_control_40` (con su fecha estimada y si están vencidos) y backlogs en "Listo para programar" (con prioridad, HH y si tienen los repuestos).
- Tarjetas por tipo: un color para preventiva, otro para rutina 40 h, otro para correctiva y otro para emergencia. El borde muestra la prioridad P1 a P4.
- Arrastrar una tarjeta de la columna lateral a una celda crea o programa la OT en ese equipo, día y turno. Moverla de celda la reprograma y pide el motivo, que queda en la bitácora.
- Soltar un backlog sobre la tarjeta de un PM del mismo equipo lo agrupa en esa OT. Al abrir la tarjeta del PM, se ven los backlogs del equipo que se pueden sumar.
- Barra de carga por especialidad (Mecánico, Eléctrico, Hidráulico, Soldador, Llantero) arriba del tablero, con las HH programadas contra `capacidad_taller`. Se recalcula al mover cada tarjeta y se pone roja si la semana pasa la capacidad.
- Avisos en la celda: dos OT del mismo equipo en el mismo turno, PM que se programa después de su fecha estimada, backlog cuyos repuestos no llegan antes de la fecha.
- Cambios en tiempo real con Supabase Realtime: si un planificador mueve una tarjeta, los demás la ven moverse sin recargar.
- Salida: programa de la semana en PDF y Excel, por unidad y por especialidad.

## Propuestas de mejora

1. Ficha de equipo única. En el CMMS 0.1.0 las dos fichas quedaron en pestañas (Preventivo y Backlog) de la misma página. El paso siguiente es una sola vista con horómetros y tendencia, último y próximo PM, backlog abierto, OT abiertas y el historial de OT cerradas del equipo.
2. Programar el backlog junto al PM. Al confirmar una OT preventiva, el CMMS muestra los backlogs del mismo equipo en "Listo para programar" y permite agregarlos a esa OT. Reemplaza el campo `aprovechar_pm`, que hoy es solo una marca.
3. Carga del taller con PM incluido. `v_carga_semanal` cuenta solo HH de backlog. Con HH estándar por gama en `pautas_gama`, la carga de la semana suma preventivo y correctivo contra `capacidad_taller`, por especialidad y unidad.
4. Pauta por gama. Cada gama (250, 500, 1000 h, etc.) tiene su lista de tareas y repuestos; la OT las copia y el técnico marca lo hecho. Las tareas no hechas quedan como backlog con un clic.
5. Kits SAP en la OT. `planes_mp.kits_sap` hoy es texto. Pasa a filas en `ot_repuestos` con estado (Por pedir, Pedido, Recibido), igual que los repuestos de backlog, para saber antes de la semana si el kit está.
6. Un solo catálogo de sistemas. Preventivos usa tres secciones fijas en `src/lib/sistemas.tsx` (motor diésel, compresor, perforadoras y empernadoras) y backlog usa la tabla `sistemas` con familias (migración 016). Se liga cada componente de preventivos a un sistema del catálogo, para filtrar OT, PM y backlog por el mismo sistema.
7. Detenciones del equipo. Tabla nueva con inicio, fin, motivo y OT ligada. Con las horas operadas que ya salen de `lecturas` se calculan disponibilidad física, MTBF y MTTR por equipo y flota.
8. Indicadores de CMMS en una sola pantalla: cumplimiento del programa semanal (OT programadas contra ejecutadas en la semana), cumplimiento de PM (ya existe `v_cumplimiento_pm`), relación preventivo/correctivo en HH, backlog en semanas de capacidad (ya existe `v_semanas_backlog`), reprogramaciones por causa, OT de emergencia por equipo.
9. Un solo reporte semanal. Los dos workflows `reporte_semanal.yml` mandan hoy dos correos; queda uno con el Excel de las dos partes y la hoja de OT de la semana.
10. Un solo mantenimiento de base. Con una base, queda un workflow de respaldo y de consulta diaria en vez de dos.
11. Número de OT SAP. Se mantiene el campo `ot_sap` para cruzar con SAP; la OT del CMMS tiene folio propio para no depender de que la OT SAP exista antes de programar.
12. Versión móvil para el técnico. Las dos apps ya compilan para web y tienen `lib/movil.ts`. En el CMMS, la vista de celular muestra las OT del turno del técnico, la pauta y la captura de lectura y fotos al cerrar.

## Riesgos y control

| Riesgo | Control |
|---|---|
| Un equipo de preventivos no calza por cod_interno (escrito distinto) | el ensayo lista los equipos creados; si uno ya existía con otro código, se corrige el código en una de las dos bases antes de grabar |
| Un usuario tiene rol o unidades distintos en las dos apps | el ensayo lo lista; queda el perfil de backlog y el admin lo ajusta en Usuarios |
| Un PC sigue con la conexión vieja de preventivos y graba en el proyecto viejo después de la fusión | al terminar la copia, en el proyecto de preventivos se deja a todos los perfiles inactivos: `rol_actual()` devuelve vacío para un perfil inactivo y las políticas no dejan leer ni grabar |
| Una política deja ver o grabar de más | el ensayo prueba que el capturador de Veta Nueva no ve ni graba en HEMCO; `tests/compat_preventivos.mjs` y `tests/flujo_backlog.mjs` corren las apps actuales contra la base del CMMS |
| Cambios de esquema del CMMS rompen las apps viejas | mientras las apps viejas estén en uso, el CMMS solo agrega tablas y columnas; no renombra ni borra las que ellas leen |
| Las validaciones de lecturas rechazan datos históricos al copiarlos | la herramienta apaga los disparadores de validación solo durante la copia (dentro de la transacción) y los vuelve a encender; el ensayo comprueba que quedan activos |

## Decisiones pendientes

1. Aprobación y fecha de la ventana para la fusión de datos (fase 2).
2. Lista de tareas y HH estándar por gama de cada plan MP (hoy no están en ninguna de las dos bases); sin esto, las OT preventivas salen sin pauta y sin HH en la carga del taller.
3. Estados de OT y si el cierre lo hace el capturador o lo valida el admin, como en backlog desde la migración 018.
