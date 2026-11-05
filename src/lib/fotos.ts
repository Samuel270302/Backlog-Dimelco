import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";
import type { BacklogFoto } from "./types";

// Fotos de backlog en Supabase Storage (bucket privado backlog-fotos).
// Ruta: <unidad_id>/<backlog_id>/<uuid>.jpg; las políticas de 007 deciden por la unidad.
export const BUCKET = "backlog-fotos";
const LADO_MAXIMO = 1600;
const CALIDAD = 0.8;
const VIGENCIA_URL_S = 3600;

export interface FotoConUrl extends BacklogFoto {
  url: string | null;
}

// Reduce la foto a 1600 px de lado mayor y la pasa a JPEG: una foto de celular de
// 4 MB queda en 200 a 400 KB.
export async function reducirImagen(archivo: File): Promise<Blob> {
  const bitmap = await createImageBitmap(archivo);
  const escala = Math.min(1, LADO_MAXIMO / Math.max(bitmap.width, bitmap.height));
  const lienzo = document.createElement("canvas");
  lienzo.width = Math.round(bitmap.width * escala);
  lienzo.height = Math.round(bitmap.height * escala);
  const ctx = lienzo.getContext("2d");
  if (!ctx) throw new Error("No se pudo procesar la imagen");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, lienzo.width, lienzo.height);
  ctx.drawImage(bitmap, 0, 0, lienzo.width, lienzo.height);
  bitmap.close();
  return await new Promise((ok, mal) =>
    lienzo.toBlob((b) => (b ? ok(b) : mal(new Error("No se pudo convertir la imagen"))), "image/jpeg", CALIDAD)
  );
}

// Sube las fotos y graba cada fila. Devuelve cuántas subió y los errores por archivo.
export async function subirFotos(
  backlog: { id: string; unidad_id: string },
  archivos: File[],
  repuestoId: string | null = null
): Promise<{ subidas: number; errores: string[] }> {
  let subidas = 0;
  const errores: string[] = [];
  for (const archivo of archivos) {
    try {
      if (!archivo.type.startsWith("image/")) throw new Error("no es una imagen");
      const blob = await reducirImagen(archivo);
      const ruta = `${backlog.unidad_id}/${backlog.id}/${crypto.randomUUID()}.jpg`;
      const { error: e1 } = await supabase().storage.from(BUCKET).upload(ruta, blob, { contentType: "image/jpeg" });
      if (e1) throw e1;
      const { error: e2 } = await supabase().from("backlog_fotos").insert({ backlog_id: backlog.id, ruta, repuesto_id: repuestoId });
      if (e2) {
        await supabase().storage.from(BUCKET).remove([ruta]);
        throw e2;
      }
      subidas++;
    } catch (e) {
      errores.push(`${archivo.name}: ${(e as Error).message}`);
    }
  }
  return { subidas, errores };
}

export async function borrarFoto(foto: BacklogFoto) {
  const { error: e1 } = await supabase().from("backlog_fotos").delete().eq("id", foto.id);
  if (e1) throw e1;
  const { error: e2 } = await supabase().storage.from(BUCKET).remove([foto.ruta]);
  if (e2) throw e2;
}

async function conUrls(fotos: BacklogFoto[]): Promise<FotoConUrl[]> {
  if (!fotos.length) return [];
  const { data, error } = await supabase()
    .storage.from(BUCKET)
    .createSignedUrls(
      fotos.map((f) => f.ruta),
      VIGENCIA_URL_S
    );
  if (error) throw error;
  const porRuta = new Map((data ?? []).map((d) => [d.path, d.signedUrl]));
  return fotos.map((f) => ({ ...f, url: porRuta.get(f.ruta) ?? null }));
}

export const useFotosBacklog = (id: string) =>
  useQuery({
    queryKey: ["backlog_fotos", id],
    // Las URL firmadas duran una hora: se renuevan antes de vencer.
    staleTime: (VIGENCIA_URL_S - 300) * 1000,
    queryFn: async () => {
      const { data, error } = await supabase().from("backlog_fotos").select("*").eq("backlog_id", id).order("creado_en");
      if (error) throw error;
      return conUrls(data as BacklogFoto[]);
    },
  });
