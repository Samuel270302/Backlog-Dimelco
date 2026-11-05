# Control de Backlog - Dimelco

Aplicación para gestionar el backlog de mantenimiento de la flota: trabajos pendientes de equipo detectados en inspección, PM, operación, fallas o análisis de aceite, con horas hombre por especialidad, repuestos, programación semanal contra la capacidad del taller y cierre con OT.

Es una app separada de Control de Preventivos: repositorio, proyecto Supabase, usuarios, instalador y carpeta de datos propios. Del repositorio de preventivos se tomó la base (autenticación, roles, unidades, menú, estilos, exportación, Electron); los equipos se copian una vez con `tools/importar_equipos.py`.

## Arquitectura

Electron + React + TypeScript para escritorio Windows. El mismo código compila como sitio web (`npm run build:web`), pero la publicación web quedó para más adelante. Base PostgreSQL en Supabase con seguridad por rol (admin, capturador, invitado) y por unidad (HEMCO, Veta Nueva, Mina La India, Explotec). El flujo de estados se valida en la base con `cambiar_estado_backlog()`; la app no cambia el estado con un update directo.

## Flujo

Etapas visibles (Kanban y barra de avance): 1. Identificado, 2. Planeado, 3. Programado, 4. Ejecutado, 5. Validado.

    Identificado -> En planificación -> Esperando repuestos -> Listo para programar -> Programado -> Ejecutado -> Validado
                 \-> Rechazado        (Planeado agrupa estos tres; al recibir el último repuesto pasa solo a Listo)
    Programado -> Programado (reprogramación con fecha nueva y motivo, misma OT)
    Programado -> Listo para programar (quitar del calendario, con motivo)
    Cualquier estado abierto -> Anulado (con motivo)

## Estructura

    supabase/migrations/   esquema, flujo de estados, vistas, políticas y Storage
    supabase/functions/    admin-usuarios (altas y contraseñas desde la app)
    electron/              proceso principal
    src/                   interfaz React (pantallas en src/pages)
    tools/                 importador de equipos y pruebas de la base

## Comandos

    npm install            dependencias
    npm run dev            interfaz en modo desarrollo (navegador)
    npm run build          compila renderer y proceso principal
    npm run build:web      compila el sitio web (usa .env.web)
    npm run dist           instalador de Windows
    tools/prueba_local.sh       aplica las migraciones en un PostgreSQL temporal y prueba el flujo por rol
    tests/e2e.sh                prueba en navegador (Playwright) contra la base local, con dos usuarios
    tests/e2e.sh electron.mjs   prueba de la app de escritorio (Electron): PDF, Excel y fotos

## Puesta en marcha

Ver [INSTALACION.md](INSTALACION.md): base de datos (`supabase/instalar_todo.sql` o migraciones 001 a 012), verificación con `tools/verificar_instalacion.sql`, datos de arranque, instalación en cada PC, primer recorrido, actualizaciones y respaldo.
