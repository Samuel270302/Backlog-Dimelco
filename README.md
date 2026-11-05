# Control de Backlog - Dimelco

Aplicación para gestionar el backlog de mantenimiento de la flota: trabajos pendientes de equipo detectados en inspección, PM, operación, fallas o análisis de aceite, con horas hombre por especialidad, repuestos, programación semanal contra la capacidad del taller y cierre con OT.

Es una app separada de Control de Preventivos: repositorio, proyecto Supabase, usuarios, instalador y carpeta de datos propios. Del repositorio de preventivos se tomó la base (autenticación, roles, unidades, menú, estilos, exportación, Electron); los equipos se copian una vez con `tools/importar_equipos.py`.

## Arquitectura

Electron + React + TypeScript para escritorio Windows, y el mismo código como sitio web para celular y tablet. Base PostgreSQL en Supabase con seguridad por rol (admin, capturador, invitado) y por unidad (HEMCO, Veta Nueva, Mina La India, Explotec). El flujo de estados se valida en la base con `cambiar_estado_backlog()`; la app no cambia el estado con un update directo.

## Flujo

    Identificado -> En planificación -> Esperando repuestos -> Listo para programar -> Programado -> Ejecutado -> Cerrado
                 \-> Rechazado        (al recibir el último repuesto pasa solo a Listo)
    Cualquier estado abierto -> Anulado (con motivo)
    Programado -> Listo para programar (reprogramación con motivo)

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
    tools/prueba_local.sh  aplica las migraciones en un PostgreSQL temporal y prueba el flujo por rol

## Puesta en marcha

1. Crear un proyecto nuevo en supabase.com (no usar el de preventivos).
2. Aplicar en orden `supabase/migrations/001_base.sql` a `007_storage.sql` en el SQL Editor.
3. Desplegar la función: `supabase functions deploy admin-usuarios`.
4. Crear el primer usuario en Authentication → Users y, en el SQL Editor, activarlo como admin:
   `update perfiles set rol = 'admin', activo = true where correo = '<correo>';`
5. Copiar los equipos: `python3 tools/importar_equipos.py --dsn-origen "<preventivos>" --dsn-destino "<backlog>" --probar`, revisar y repetir sin `--probar`.
6. Cargar la capacidad del taller y los plazos por prioridad (los valores iniciales son provisionales).
7. En cada PC, instalar la app y capturar URL del proyecto y llave anon. Para la web, crear `.env.web` con `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`.
