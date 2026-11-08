# Plan de fusión: CMMS Dimelco (preventivos + backlog + órdenes de trabajo)

Documento de planificación, 08/11/2026. Base: Control de Preventivos 0.6.0 (repositorio Control-de-preventivos-Dimelco) y Control de Backlog 0.5.5 (repositorio Backlog-Dimelco). El mismo archivo está en `docs/PLAN_CMMS.md` de los dos repositorios.

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

### Una sola base: el proyecto Supabase de preventivos

La base fusionada es el proyecto de preventivos, ampliado con las tablas de backlog y las de órdenes de trabajo. Razones:

1. Tiene el histórico más grande (lecturas por turno y PM importados del libro "Registro de horometros HEMCO v2.xlsx" y de las otras unidades), que es lo más caro de mover.
2. El plan Free de Supabase permite dos proyectos activos por organización; un tercer proyecto para el CMMS obligaría a pagar o a pausar uno de los actuales.
3. Ninguna tabla de backlog tiene el mismo nombre que una tabla propia de preventivos, así que entran sin renombrar y la app de backlog actual sigue leyendo sus tablas con los mismos nombres.

### Una app nueva al lado de las actuales

La app nueva es "CMMS Dimelco", en un repositorio nuevo (`CMMS-Dimelco`, lo crea el dueño de la cuenta de GitHub). Se arma desde el código de preventivos 0.6.0 y se le copian las pantallas de backlog. Tiene `appId` propio (`com.hemco.cmms`), carpeta de datos propia y su propio instalador y sitio web, así que se instala en el mismo PC sin tocar las otras dos.

Las apps actuales quedan habilitadas:

- Control de Preventivos sigue igual: misma base, mismo instalador, mismo sitio.
- Control de Backlog pasa a la versión 0.5.6, que solo cambia de base: en escritorio, el admin cambia la conexión en la pantalla de configuración de cada PC (URL y llave anon del proyecto de preventivos); en web, se cambian los secretos `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` del repositorio y se vuelve a publicar.

Como las tres apps leen y graban en la misma base, un backlog creado en la app vieja aparece en el CMMS y al revés. No hay copias que sincronizar. Cuando los usuarios ya trabajen en el CMMS, las apps viejas se pueden retirar cuando se decida, sin migración adicional.

## Modelo de datos fusionado

### Tablas compartidas: cómo se reconcilian

| Objeto | Preventivos | Backlog | Resultado en la base fusionada |
|---|---|---|---|
| unidades | id, nombre, activo, orden | más `sigla` | se agrega `sigla` (HEM, VTN, MLI, EXP); los id de backlog se cruzan por nombre |
| perfiles | rol, activo, unidad_id, unidades[] | igual | se unen por `user_id`; si un usuario está en las dos con datos distintos, manda preventivos y la diferencia se lista para que el admin decida |
| parametros | claves de horómetro y tendencia | plazos P1 a P4, marca `prioridades_dimelco` | se agregan las claves de backlog con sus valores actuales (no los provisionales) |
| equipos | fecha_inicio_operacion, creado_por | flota, familia_id | se agregan `flota` y `familia_id`; los equipos de backlog se cruzan por unidad + cod_interno; los que solo existen en backlog se insertan |
| crear_perfil() | perfil nuevo invitado inactivo | capturador inactivo | queda la versión de preventivos (invitado inactivo); el admin activa y fija el rol igual que hoy |
| rol_actual, unidad_actual, unidades_actuales, unidad_permitida, usuario_sesion, hoy, param | iguales en lógica; preventivos 015 usa `auth.uid()` y backlog `usuario_sesion()` | | una sola versión basada en `usuario_sesion()`, que da lo mismo que `auth.uid()` en Supabase y además corre en la base local de pruebas |
| admin-usuarios (Edge Function) | acepta `unidades` y `unidad_id` | solo `unidad_id` | queda la de preventivos |
| políticas RLS de las cuatro tablas compartidas | | | se juntan en una política por tabla y operación; la prueba por rol de las dos apps tiene que pasar |

### Tablas que entran sin cambios

De backlog: backlogs, folios, backlog_hh, backlog_repuestos, backlog_eventos, backlog_fotos, sistemas, familias, familia_sistemas, especialidades, capacidad_taller, con sus vistas, disparadores y `cambiar_estado_backlog()` (migraciones 003 a 018). Los `id` de backlog se conservan, igual que los folios BL-HEM-000123.

De preventivos: todo lo que ya está, sin tocar. La validación de `v_control_pm` y `v_control_40` contra el libro (`tools/validate_control.py`) tiene que seguir dando 0 diferencias después de la fusión.

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

Lo de preventivos ya está en la base fusionada. Lo que se mueve es lo de backlog.

1. Ensayo local. Con los respaldos cifrados de la rama `respaldos` de cada repositorio se restauran las dos bases en un PostgreSQL local (como hace hoy `tools/prueba_local.sh`), se corre la fusión completa y se comparan conteos. El ensayo se repite hasta que la verificación salga limpia.
2. Aviso y congelamiento. Se fija una ventana (por ejemplo, un sábado por la tarde) en la que nadie graba en backlog. Se corre a mano el workflow "Mantenimiento de la base" en los dos repositorios para tener un respaldo del mismo momento.
3. Migración de esquema en preventivos (`019_fusion_backlog.sql`): columnas nuevas en unidades y equipos, funciones de sesión unificadas, tablas y vistas de backlog (las migraciones 002 a 018 de backlog adaptadas, sin crear de nuevo unidades, perfiles, parametros ni equipos), bucket `backlog-fotos` y políticas.
4. Copia de datos con `tools/fusionar_backlog.py --dsn-origen <backlog> --dsn-destino <preventivos> --probar` (el origen se abre solo lectura, como en `importar_equipos.py`):
   - unidades por nombre; equipos por unidad + cod_interno, con tabla de cruce id viejo -> id nuevo;
   - sistemas, familias, familia_sistemas, especialidades por nombre;
   - perfiles por `user_id`; los usuarios que solo existen en backlog se copian con `auth.users` y `auth.identities` (la misma técnica de `exportar_usuarios_preventivos.sql`, en sentido inverso), con la misma contraseña;
   - backlogs y sus tablas hijas con el mismo `id`, cambiando `unidad_id` y `equipo_id` por los de la tabla de cruce;
   - folios con el último correlativo de cada unidad;
   - capacidad_taller y parámetros de plazos con sus valores actuales;
   - fotos: cada archivo de `backlog-fotos` se descarga y se sube al bucket de la base fusionada con el `unidad_id` nuevo en la ruta, y se actualiza `backlog_fotos.ruta`.
   La opción `--probar` hace todo dentro de una transacción y la deshace al final, para ver los conteos antes de grabar.
5. Verificación (`tools/verificar_fusion.sql`): por unidad, la misma cantidad de backlogs por estado, la misma suma de HH estimadas y reales, los mismos repuestos por estado, la misma cantidad de fotos (y cada ruta existe en Storage), ningún backlog sin equipo, folios sin repetir; y en preventivos, `validate_control.py` con 0 diferencias y los mismos conteos de lecturas y registros PM que antes.
6. Cambio de conexión de Control de Backlog 0.5.6 en cada PC y en la web, y cambio del secreto `SUPABASE_DB_URL` en el repositorio Backlog-Dimelco para que el respaldo diario y el reporte semanal lean la base fusionada.
7. El proyecto Supabase de backlog queda sin uso por 30 días como respaldo (con el respaldo cifrado de la rama `respaldos` como segunda copia) y después se pausa. Ese espacio queda libre para un proyecto de pruebas.

## Fases

| Fase | Contenido | Versión | Termina cuando |
|---|---|---|---|
| 0 | Ensayo de fusión en base local con los respaldos; scripts `fusionar_backlog.py` y `verificar_fusion.sql` | sin publicar | dos ensayos seguidos con verificación limpia |
| 1 | Fusión de bases (pasos 2 a 6) | Backlog 0.5.6 | backlog trabaja en la base de preventivos y las pruebas por rol de las dos apps pasan |
| 2 | Repositorio CMMS-Dimelco con las pantallas de las dos apps bajo un solo menú, un login y una sola pantalla de usuarios | CMMS 0.1.0 | un usuario hace en el CMMS todo lo que hacía en las dos apps |
| 3 | Órdenes de trabajo: tablas, `cambiar_estado_ot()`, OT sugeridas desde Control PM, OT desde backlog, cierre que escribe registros_pm y backlog Ejecutado | CMMS 0.2.0 | un PM y un backlog recorren el ciclo completo con OT |
| 4 | Tablero de programación (ver abajo): preventivos y correctivos en una sola vista, con arrastrar y soltar y carga del taller en vivo | CMMS 0.3.0 | el programa de la semana se arma en el tablero y sale en PDF y Excel |
| 5 | Indicadores de CMMS (ver propuestas) y reporte semanal único | CMMS 0.4.0 | el reporte del lunes reemplaza a los dos reportes actuales |

Menú propuesto para el CMMS, a partir de las rutas actuales:

    Inicio          resumen por unidad: PM por vencer, OT de la semana, backlog abierto
    Equipos         lista y ficha del equipo (horómetros, PM, backlog, OT, historial)
    Preventivo      Control PM, Rutina 40 h, Lecturas, Registro PM, Cambios de horómetro, Gráficas
    Backlog         Por equipo, Kanban, Nuevo backlog
    Órdenes de trabajo   Sugeridas, Abiertas, Nueva OT, Historial
    Programación    Calendario semanal, Capacidad del taller
    Indicadores
    Administración  Usuarios, Equipos, Plan MP y pautas, Catálogos, Plazos, Borrados

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

1. Ficha de equipo única. Hoy hay dos (`FichaEquipo.tsx` en cada app). La nueva junta horómetros y tendencia, último y próximo PM, backlog abierto, OT abiertas y el historial de OT cerradas del equipo.
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
| Un equipo de backlog no calza por cod_interno (escrito distinto) | el ensayo lista los no cruzados; el admin los corrige en una de las dos bases antes de la fusión real |
| Un usuario tiene rol o unidades distintos en las dos apps | se lista; manda preventivos salvo que el admin indique otra cosa |
| Fotos que no se copian | la verificación compara cantidad y existencia de cada ruta; el proyecto viejo sigue 30 días |
| Un PC sigue con la conexión vieja de backlog y graba en el proyecto viejo después de la fusión | al terminar la copia, en el proyecto viejo se deja a todos los perfiles inactivos: `rol_actual()` devuelve vacío para un perfil inactivo y las políticas no dejan leer ni grabar |
| Una política RLS unificada deja ver o grabar de más | las pruebas por rol de las dos apps (`tools/prueba_local.sh`, `tests/electron_roles.mjs`) corren contra la base fusionada antes del paso 6 |
| Cambios de esquema del CMMS rompen las apps viejas | mientras las apps viejas estén en uso, el CMMS solo agrega tablas y columnas; no renombra ni borra las que ellas leen |

## Decisiones pendientes

1. Crear el repositorio `CMMS-Dimelco` en GitHub y darle acceso a Claude, o indicar si el CMMS va dentro de uno de los dos repositorios actuales.
2. Confirmar que la base fusionada es el proyecto Supabase de preventivos.
3. Lista de tareas y HH estándar por gama de cada plan MP (hoy no están en ninguna de las dos bases); sin esto, las OT preventivas salen sin pauta y sin HH en la carga del taller.
4. Confirmar los estados de OT y si el cierre lo hace el capturador o lo valida el admin, como en backlog desde la migración 018.
5. Fecha de la ventana de fusión.
