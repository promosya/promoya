// Base de datos D1: esquema, ayudas de consulta y configuración.

const ESQUEMA = [
  `CREATE TABLE IF NOT EXISTS contactos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    soundcloud TEXT NOT NULL DEFAULT '',
    tipo TEXT NOT NULL DEFAULT 'dj',
    pais TEXT NOT NULL DEFAULT '',
    etiquetas TEXT NOT NULL DEFAULT '',
    notas TEXT NOT NULL DEFAULT '',
    estado TEXT NOT NULL DEFAULT 'activo',
    creado INTEGER NOT NULL,
    actualizado INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS ix_contactos_sc ON contactos(soundcloud)`,
  `CREATE TABLE IF NOT EXISTS grupos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    creado INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS grupo_contactos (
    grupo_id INTEGER NOT NULL,
    contacto_id INTEGER NOT NULL,
    PRIMARY KEY (grupo_id, contacto_id)
  )`,
  `CREATE TABLE IF NOT EXISTS campanias (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    tema TEXT NOT NULL DEFAULT '',
    artista TEXT NOT NULL DEFAULT '',
    link TEXT NOT NULL,
    imagen TEXT NOT NULL DEFAULT '',
    asunto_a TEXT NOT NULL,
    asunto_b TEXT NOT NULL DEFAULT '',
    cuerpo TEXT NOT NULL,
    recordatorio_dias INTEGER NOT NULL DEFAULT 4,
    recordatorio_asunto TEXT NOT NULL DEFAULT '',
    recordatorio_cuerpo TEXT NOT NULL DEFAULT '',
    ab_ganador TEXT,
    estado TEXT NOT NULL DEFAULT 'borrador',
    inicio TEXT,
    creado INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS campania_grupos (
    campania_id INTEGER NOT NULL,
    grupo_id INTEGER NOT NULL,
    orden INTEGER NOT NULL,
    dia TEXT,
    PRIMARY KEY (campania_id, grupo_id)
  )`,
  `CREATE TABLE IF NOT EXISTS envios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT NOT NULL UNIQUE,
    campania_id INTEGER NOT NULL,
    contacto_id INTEGER NOT NULL,
    grupo_id INTEGER,
    tipo TEXT NOT NULL DEFAULT 'principal',
    variante TEXT,
    asunto TEXT,
    estado TEXT NOT NULL DEFAULT 'pendiente',
    programado INTEGER NOT NULL,
    enviado INTEGER,
    gmail_id TEXT,
    gmail_hilo TEXT,
    error TEXT,
    abierto INTEGER,
    aperturas INTEGER NOT NULL DEFAULT 0,
    clic INTEGER,
    clics INTEGER NOT NULL DEFAULT 0,
    escuchado INTEGER,
    respondio INTEGER,
    UNIQUE (campania_id, contacto_id, tipo)
  )`,
  `CREATE INDEX IF NOT EXISTS ix_envios_cola ON envios(estado, programado)`,
  `CREATE INDEX IF NOT EXISTS ix_envios_contacto ON envios(contacto_id)`,
  `CREATE TABLE IF NOT EXISTS eventos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    envio_id INTEGER,
    contacto_id INTEGER,
    campania_id INTEGER,
    tipo TEXT NOT NULL,
    ts INTEGER NOT NULL,
    detalle TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE INDEX IF NOT EXISTS ix_eventos_contacto ON eventos(contacto_id, ts)`,
  `CREATE INDEX IF NOT EXISTS ix_eventos_ts ON eventos(ts)`,
  `CREATE TABLE IF NOT EXISTS config (clave TEXT PRIMARY KEY, valor TEXT)`,
  `CREATE TABLE IF NOT EXISTS gmail_vistos (id TEXT PRIMARY KEY, ts INTEGER)`,
];

// Cambios de esquema sobre bases ya creadas (se aplican una sola vez, en orden).
const MIGRACIONES = [
  // v2: dos listas: «contactos» (DJs, sellos, radios: los importantes) y «usuarios» (gente que descargó tu música)
  ["ALTER TABLE contactos ADD COLUMN lista TEXT NOT NULL DEFAULT 'contactos'", "ALTER TABLE grupos ADD COLUMN lista TEXT NOT NULL DEFAULT 'contactos'", 'CREATE INDEX IF NOT EXISTS ix_contactos_lista ON contactos(lista, estado)'],
];
const VERSION = MIGRACIONES.length + 1;

// El plan gratis de Cloudflare permite 50 consultas a la base por pasada; un db.batch() cuenta como UNA.
// Por eso todo lo que se repite por contacto o por mail se junta en lotes.
let listo = false;
export async function asegurarEsquema(db) {
  if (listo) return;
  const res = await db.batch([...ESQUEMA.map((s) => db.prepare(s)), db.prepare("SELECT valor FROM config WHERE clave = 'esquema'")]);
  const actual = Number(res.at(-1).results?.[0]?.valor || 1);
  for (let v = actual; v < VERSION; v++) {
    for (const sql of MIGRACIONES[v - 1]) {
      try { await db.prepare(sql).run(); } catch (e) { if (!/duplicate column/i.test(e.message)) throw e; }
    }
  }
  if (actual < VERSION) await guardarConfig(db, 'esquema', VERSION);
  listo = true;
}

export const todos = async (db, sql, ...p) => (await db.prepare(sql).bind(...p).all()).results;
export const uno = (db, sql, ...p) => db.prepare(sql).bind(...p).first();
export const ejec = (db, sql, ...p) => db.prepare(sql).bind(...p).run();
export const sentencia = (db, sql, ...p) => db.prepare(sql).bind(...p);
// Ejecuta muchas sentencias en lotes grandes (cada lote = 1 consulta para el límite de Cloudflare)
export async function enLotes(db, sentencias, tam = 400) {
  for (let i = 0; i < sentencias.length; i += tam) await db.batch(sentencias.slice(i, i + tam));
}
export const eventoSql = (db, { envio_id = null, contacto_id = null, campania_id = null, tipo, detalle = '', ts = Date.now() }) =>
  sentencia(db, 'INSERT INTO eventos (envio_id, contacto_id, campania_id, tipo, ts, detalle) VALUES (?, ?, ?, ?, ?, ?)', envio_id, contacto_id, campania_id, tipo, ts, detalle);

// Solo para probar en la PC (CONTAR_CONSULTAS=1): cuenta las consultas de cada pasada para no pasarse de 50.
export function contarConsultas(db, etiqueta) {
  let n = 0;
  const envolver = (st) => new Proxy(st, { get(t, k) {
    if (k === 'bind') return (...a) => envolver(t.bind(...a));
    if (['first', 'all', 'run', 'raw'].includes(k)) return (...a) => { n++; return t[k](...a); };
    const v = t[k]; return typeof v === 'function' ? v.bind(t) : v;
  } });
  const proxy = new Proxy(db, { get(t, k) {
    if (k === 'prepare') return (sql) => envolver(t.prepare(sql));
    if (k === 'batch') return (st) => { n++; return t.batch(st); };
    if (k === '__consultas') return () => n;
    const v = t[k]; return typeof v === 'function' ? v.bind(t) : v;
  } });
  proxy.__informar = () => console.log(`[consultas] ${etiqueta}: ${n}`);
  return proxy;
}

// ---- Configuración ----
export const CONFIG_DEFECTO = {
  tope_diario: '490',       // máximo de mails por día, todas las campañas juntas (Gmail personal corta en 500)
  arranque: '100,250,490',  // arranque gradual: tope por semana desde el primer envío
  hora_desde: '10',         // ventana de envío (hora Argentina)
  hora_hasta: '20',
  hora_envio: '11',         // hora por defecto si no se conoce la mejor hora del contacto
  tanda: '8',               // mínimo de mails por pasada (cada 10 min); sube solo si hace falta para llegar al tope
  separar_listas: '1',      // contactos y usuarios nunca el mismo día
  remitente_nombre: '',      // nombre artístico (se carga en Primeros pasos)
  firma: '',                 // se arma con tu nombre y tu SoundCloud si la dejás vacía
  recordatorio_dias: '4',
  frio_promos: '3',         // promos seguidas sin abrir para marcarlo frío
};

export async function leerConfig(db) {
  const filas = await todos(db, 'SELECT clave, valor FROM config');
  const c = { ...CONFIG_DEFECTO };
  for (const f of filas) c[f.clave] = f.valor;
  return c;
}

export const guardarConfig = (db, clave, valor) =>
  ejec(db, 'INSERT INTO config (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor', clave, String(valor));

export const registrarEvento = (db, { envio_id = null, contacto_id = null, campania_id = null, tipo, detalle = '', ts = Date.now() }) =>
  ejec(db, 'INSERT INTO eventos (envio_id, contacto_id, campania_id, tipo, ts, detalle) VALUES (?, ?, ?, ?, ?, ?)',
    envio_id, contacto_id, campania_id, tipo, ts, detalle);
