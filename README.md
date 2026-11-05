# Respaldos de la base de datos (cifrados)

Generados cada día por el flujo "Mantenimiento de la base".
Cada carpeta tiene dos archivos cifrados con gpg (AES-256):
- AAAA-MM-DD_public.sql.gz.gpg: tablas de la app con estructura y datos.
- AAAA-MM-DD_usuarios.sql.gz.gpg: usuarios de inicio de sesión (auth.users y auth.identities).

La frase de cifrado es el valor completo del secreto SUPABASE_DB_URL
(está en SECRETO_GITHUB.txt, que guarda el administrador).

Restaurar en un proyecto Supabase nuevo y vacío:
1. gpg -d AAAA-MM-DD_usuarios.sql.gz.gpg | gunzip | psql "<cadena de conexión>"
2. gpg -d AAAA-MM-DD_public.sql.gz.gpg | gunzip | psql "<cadena de conexión>"
3. Aplicar supabase/migrations/006_rls.sql y 007_storage.sql del repositorio (políticas, tiempo real y fotos).
Las fotos de Storage no van en este respaldo.
gpg pide la frase al descifrar.
