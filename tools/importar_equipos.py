#!/usr/bin/env python3
"""Copia única del catálogo de equipos desde la app de preventivos a la de backlog.

Origen (uno de los dos):
  --csv equipos.csv           columnas: unidad, cod_interno, cod_sap, modelo, activo
  --dsn-origen "<cadena>"     base de preventivos; solo se hace un SELECT

Destino:
  --dsn-destino "<cadena>"    base de backlog (proyecto Supabase nuevo)

La unidad se cruza por nombre (HEMCO, Veta Nueva, Mina La India, Explotec). La flota se
toma del código interno antes del "#" (Scooptram #1 -> Scooptram). Si el equipo ya
existe en la unidad, se actualizan cod_sap, modelo y activo. Después de esta carga cada
app administra sus equipos por separado.

  python3 tools/importar_equipos.py --dsn-origen "$PREV" --dsn-destino "$BACK" --probar
"""
import argparse
import csv
import sys

import psycopg2

CONSULTA_ORIGEN = """
select u.nombre, e.cod_interno, e.cod_sap, e.modelo, e.activo
from equipos e join unidades u on u.id = e.unidad_id
order by u.orden, e.cod_interno
"""


def flota(cod_interno: str) -> str | None:
    base = cod_interno.split("#")[0].strip()
    return base or None


def leer_csv(ruta: str):
    with open(ruta, newline="", encoding="utf-8-sig") as f:
        for fila in csv.DictReader(f):
            activo = str(fila.get("activo", "true")).strip().lower() not in ("false", "0", "no", "f")
            yield (fila["unidad"].strip(), fila["cod_interno"].strip(),
                   (fila.get("cod_sap") or "").strip() or None, fila["modelo"].strip(), activo)


def leer_origen(dsn: str):
    con = psycopg2.connect(dsn)
    con.set_session(readonly=True)
    try:
        with con.cursor() as cur:
            cur.execute(CONSULTA_ORIGEN)
            return cur.fetchall()
    finally:
        con.close()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    origen = ap.add_mutually_exclusive_group(required=True)
    origen.add_argument("--csv")
    origen.add_argument("--dsn-origen")
    ap.add_argument("--dsn-destino", required=True)
    ap.add_argument("--probar", action="store_true", help="muestra lo que haría y deshace la transacción")
    a = ap.parse_args()

    filas = list(leer_csv(a.csv)) if a.csv else leer_origen(a.dsn_origen)
    con = psycopg2.connect(a.dsn_destino)
    try:
        with con, con.cursor() as cur:
            cur.execute("select nombre, id from unidades")
            unidades = dict(cur.fetchall())
            faltan = sorted({f[0] for f in filas} - unidades.keys())
            if faltan:
                sys.exit(f"Unidades que no existen en backlog: {', '.join(faltan)}")
            nuevos = actualizados = 0
            for unidad, cod, sap, modelo, activo in filas:
                cur.execute(
                    """insert into equipos (unidad_id, cod_interno, cod_sap, modelo, flota, activo)
                       values (%s, %s, %s, %s, %s, %s)
                       on conflict (unidad_id, cod_interno) do update
                         set cod_sap = excluded.cod_sap, modelo = excluded.modelo, activo = excluded.activo
                       returning (xmax = 0)""",
                    (unidades[unidad], cod, sap, modelo, flota(cod), activo),
                )
                if cur.fetchone()[0]:
                    nuevos += 1
                else:
                    actualizados += 1
            print(f"{len(filas)} equipos leídos: {nuevos} nuevos, {actualizados} actualizados")
            if a.probar:
                con.rollback()
                print("Modo prueba: no se grabó nada")
    finally:
        con.close()


if __name__ == "__main__":
    main()
