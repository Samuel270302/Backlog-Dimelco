// Servidor REST mínimo para pruebas: atiende las llamadas que hace la app con
// supabase-js (select con eq/in y order, insert, update, delete y rpc) y las ejecuta
// en un PostgreSQL local con el rol "authenticated" y el usuario del token, igual que
// PostgREST. Así las pruebas pasan por las políticas y funciones reales de la base.
// No verifica la firma del token: es solo para pruebas locales.
import { createServer } from "node:http";
import pg from "pg";

// Mismos formatos JSON que PostgREST: fechas como texto YYYY-MM-DD, numeric y bigint como número.
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));

const ID = /^[a-z_][a-z0-9_]*$/;
const ident = (s) => {
  if (!ID.test(s)) throw new Error(`Identificador no permitido: ${s}`);
  return `"${s}"`;
};

function usuarioDe(req) {
  const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  try {
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function filtros(params, valores) {
  const partes = [];
  for (const [clave, valor] of params) {
    if (["select", "order", "limit", "offset", "columns"].includes(clave)) continue;
    if (valor.startsWith("eq.")) {
      valores.push(valor.slice(3));
      partes.push(`${ident(clave)}::text = $${valores.length}`);
    } else if (valor.startsWith("in.(")) {
      valores.push(valor.slice(4, -1).split(",").map((s) => s.replaceAll('"', "")));
      partes.push(`${ident(clave)}::text = any($${valores.length}::text[])`);
    } else {
      throw new Error(`Filtro no soportado: ${clave}=${valor}`);
    }
  }
  return partes.length ? ` where ${partes.join(" and ")}` : "";
}

function columnas(params) {
  const sel = params.get("select") ?? "*";
  return sel === "*" ? "*" : sel.split(",").map((c) => ident(c.trim())).join(", ");
}

function orden(params) {
  const o = params.get("order");
  if (!o) return "";
  return (
    " order by " +
    o
      .split(",")
      .map((p) => {
        const [c, dir] = p.split(".");
        return `${ident(c)} ${dir === "desc" ? "desc" : "asc"}`;
      })
      .join(", ")
  );
}

export async function iniciarServidorRest({ conexion, puerto }) {
  const pool = new pg.Pool(conexion);
  const servidor = createServer(async (req, res) => {
    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
      "access-control-expose-headers": "content-range",
    };
    if (req.method === "OPTIONS") return res.writeHead(204, cors).end();
    const url = new URL(req.url, "http://x");
    if (url.pathname.startsWith("/auth/v1/")) {
      res.writeHead(200, { ...cors, "content-type": "application/json" });
      return res.end("{}");
    }
    if (!url.pathname.startsWith("/rest/v1/")) return res.writeHead(404, cors).end();

    let cuerpo = "";
    for await (const trozo of req) cuerpo += trozo;
    const claims = usuarioDe(req);
    const ruta = url.pathname.slice("/rest/v1/".length);
    const esRpc = ruta.startsWith("rpc/");
    const objeto = (req.headers.accept ?? "").includes("vnd.pgrst.object");
    const representar = (req.headers.prefer ?? "").includes("return=representation");
    const cliente = await pool.connect();
    try {
      await cliente.query("begin");
      await cliente.query("set local role authenticated");
      await cliente.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims ?? {})]);
      const valores = [];
      let sql;
      if (esRpc) {
        const args = JSON.parse(cuerpo || "{}");
        const lista = Object.keys(args).map((k) => {
          const v = args[k];
          valores.push(v !== null && typeof v === "object" ? JSON.stringify(v) : v);
          return `${ident(k)} => $${valores.length}`;
        });
        sql = `select to_jsonb(r) as j from ${ident(ruta.slice(4))}(${lista.join(", ")}) r`;
      } else {
        const t = ident(ruta);
        if (req.method === "GET") {
          sql = `select ${columnas(url.searchParams)} from ${t}${filtros(url.searchParams, valores)}${orden(url.searchParams)}`;
        } else if (req.method === "POST") {
          const datos = JSON.parse(cuerpo);
          const filas = Array.isArray(datos) ? datos : [datos];
          const cols = Object.keys(filas[0]).map(ident).join(", ");
          valores.push(JSON.stringify(filas));
          sql = `insert into ${t} (${cols}) select ${cols} from json_populate_recordset(null::${t}, $1) returning ${columnas(url.searchParams)}`;
        } else if (req.method === "PATCH") {
          const cols = Object.keys(JSON.parse(cuerpo)).map(ident).join(", ");
          valores.push(cuerpo);
          sql = `update ${t} set (${cols}) = (select ${cols} from json_populate_record(null::${t}, $1))`;
          sql += filtros(url.searchParams, valores) + ` returning ${columnas(url.searchParams)}`;
        } else if (req.method === "DELETE") {
          sql = `delete from ${t}${filtros(url.searchParams, valores)} returning *`;
        } else {
          throw new Error(`Método no soportado: ${req.method}`);
        }
      }
      const r = await cliente.query(sql, valores);
      await cliente.query("commit");
      if (req.method !== "GET" && !esRpc && !representar) return res.writeHead(201, cors).end();
      const filas = esRpc ? r.rows.map((x) => x.j) : r.rows;
      const salida = esRpc || objeto ? (filas[0] ?? null) : filas;
      res.writeHead(200, { ...cors, "content-type": "application/json" });
      res.end(JSON.stringify(salida));
    } catch (e) {
      await cliente.query("rollback").catch(() => {});
      res.writeHead(400, { ...cors, "content-type": "application/json" });
      res.end(JSON.stringify({ message: e.message, code: e.code ?? "PGRST", details: null, hint: null }));
    } finally {
      cliente.release();
    }
  });
  await new Promise((r) => servidor.listen(puerto, r));
  return {
    cerrar: async () => {
      servidor.close();
      await pool.end();
    },
  };
}
