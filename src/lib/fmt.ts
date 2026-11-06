export function fFecha(v: string | null | undefined): string {
  if (!v) return "";
  const [a, m, d] = v.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

export function fNum(v: number | null | undefined, dec = 1): string {
  if (v === null || v === undefined) return "";
  return Number(v).toLocaleString("es-MX", {
    minimumFractionDigits: 0,
    maximumFractionDigits: dec,
  });
}

export function gamaTexto(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  const n = Number(v);
  return isFinite(n) ? fNum(n) : String(v);
}

export function hoyISO(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function sumarDiasISO(iso: string, dias: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + dias);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function fFechaHora(v: string | null | undefined): string {
  if (!v) return "";
  const d = new Date(v);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Lunes de la semana ISO de una fecha YYYY-MM-DD.
export function lunesDe(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  const dia = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dia);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
