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

// supabase-js sube un Blob como multipart/form-data: se toma la parte que trae Content-Type.
function extraerArchivo(crudo, tipo) {
  const limite = /boundary=(.+)$/.exec(tipo)?.[1];
  if (!limite) return { bytes: crudo, tipo: tipo || "application/octet-stream" };
  const sep = Buffer.from(`--${limite}`);
  let i = crudo.indexOf(sep);
  while (i !== -1) {
    const j = crudo.indexOf(sep, i + sep.length);
    if (j === -1) break;
    const parte = crudo.subarray(i + sep.length + 2, j - 2);
    const fin = parte.indexOf("\r\n\r\n");
    const cab = parte.subarray(0, fin).toString("utf8");
    const t = /Content-Type:\s*([^\r\n]+)/i.exec(cab)?.[1];
    if (t) return { bytes: parte.subarray(fin + 4), tipo: t.trim() };
    i = j;
  }
  return { bytes: crudo, tipo: "application/octet-stream" };
}

export async function iniciarServidorRest({ conexion, puerto }) {
  const pool = new pg.Pool(conexion);
  const archivos = new Map(); // "<bucket>/<ruta>" -> { bytes, tipo }

  // Ejecuta sql con el rol authenticated y el usuario del token, como PostgREST.
  async function comoUsuario(req, sql, valores) {
    const cliente = await pool.connect();
    try {
      await cliente.query("begin");
      await cliente.query("set local role authenticated");
      await cliente.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(usuarioDe(req) ?? {})]);
      const r = await cliente.query(sql, valores);
      await cliente.query("commit");
      return r.rows;
    } catch (e) {
      await cliente.query("rollback").catch(() => {});
      throw e;
    } finally {
      cliente.release();
    }
  }

  // Storage mínimo: subir, firmar, descargar firmado y borrar. Las filas van a
  // storage.objects con el usuario de la sesión: deciden las políticas de 007.
  async function almacenamiento(req, res, url, cors) {
    const json = (estado, cuerpo) => {
      res.writeHead(estado, { ...cors, "content-type": "application/json" });
      res.end(JSON.stringify(cuerpo));
    };
    const partes = [];
    for await (const t of req) partes.push(t);
    const crudo = Buffer.concat(partes);
    const ruta = decodeURIComponent(url.pathname.slice("/storage/v1/".length));
    try {
      if (req.method === "POST" && ruta.startsWith("object/sign/")) {
        const bucket = ruta.slice("object/sign/".length);
        const { paths } = JSON.parse(crudo.toString("utf8"));
        const visibles = await comoUsuario(req, "select name from storage.objects where bucket_id = $1 and name = any($2::text[])", [bucket, paths]);
        const ok = new Set(visibles.map((v) => v.name));
        return json(200, paths.map((p) => ({
          path: p,
          signedURL: ok.has(p) ? `/object/sign/${bucket}/${p}?token=prueba` : null,
          error: ok.has(p) ? null : "Sin permiso",
        })));
      }
      if (req.method === "GET" && ruta.startsWith("object/sign/")) {
        const clave = ruta.slice("object/sign/".length);
        const a = archivos.get(clave);
        if (!a) return json(404, { message: "No existe" });
        res.writeHead(200, { ...cors, "content-type": a.tipo });
        return res.end(a.bytes);
      }
      if (req.method === "POST" && ruta.startsWith("object/")) {
        const clave = ruta.slice("object/".length);
        const [bucket, ...resto] = clave.split("/");
        const nombre = resto.join("/");
        await comoUsuario(req, "insert into storage.objects (bucket_id, name) values ($1, $2)", [bucket, nombre]);
        archivos.set(clave, extraerArchivo(crudo, req.headers["content-type"] ?? ""));
        return json(200, { Key: clave, Id: nombre });
      }
      if (req.method === "DELETE" && ruta.startsWith("object/")) {
        const bucket = ruta.slice("object/".length);
        const { prefixes } = JSON.parse(crudo.toString("utf8"));
        const borrados = await comoUsuario(req, "delete from storage.objects where bucket_id = $1 and name = any($2::text[]) returning name", [bucket, prefixes]);
        for (const b of borrados) archivos.delete(`${bucket}/${b.name}`);
        return json(200, borrados.map((b) => ({ name: b.name })));
      }
      return json(404, { message: "Ruta de storage no soportada" });
    } catch (e) {
      return json(400, { statusCode: "403", error: "Unauthorized", message: e.message });
    }
  }
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
    if (url.pathname.startsWith("/storage/v1/")) return almacenamiento(req, res, url, cors);
    // Imitación de la función de borde admin-usuarios (solo el alta): hace lo mismo que
    // supabase/functions/admin-usuarios con la llave de servicio.
    if (url.pathname === "/functions/v1/admin-usuarios") {
      let crudo = "";
      for await (const trozo of req) crudo += trozo;
      const responder = (estado, obj) => {
        res.writeHead(estado, { ...cors, "content-type": "application/json" });
        res.end(JSON.stringify(obj));
      };
      const quien = usuarioDe(req);
      const c = await pool.connect();
      try {
        const { rows } = await c.query("select rol, activo from perfiles where user_id = $1", [quien?.sub ?? null]);
        if (!rows[0] || rows[0].rol !== "admin" || !rows[0].activo) return responder(403, { error: "Solo un administrador activo puede gestionar usuarios" });
        const d = JSON.parse(crudo || "{}");
        if (d.accion !== "crear") return responder(400, { error: "Acción no soportada en la prueba" });
        const unidad = d.rol === "admin" ? null : d.unidad_id || null;
        if (d.rol !== "admin" && !unidad) return responder(400, { error: "Elija la unidad del usuario" });
        const id = (await c.query(
          "insert into auth.users (id, email, raw_user_meta_data) values (gen_random_uuid(), $1, jsonb_build_object('nombre', $2::text)) returning id",
          [String(d.correo).toLowerCase(), d.nombre]
        )).rows[0].id;
        await c.query("update perfiles set nombre = $1, rol = $2, activo = true, unidad_id = $3 where user_id = $4", [d.nombre, d.rol, unidad, id]);
        return responder(200, { ok: true, user_id: id });
      } catch (e) {
        return responder(400, { error: e.message });
      } finally {
        c.release();
      }
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
