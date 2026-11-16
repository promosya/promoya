// Conexión con el Gmail del proyecto: permiso (OAuth), envío, rebotes y respuestas.
import { leerConfig, guardarConfig, todos, sentencia, enLotes, eventoSql } from './db.js';
import { token } from './util.js';

const ALCANCES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly', // para detectar rebotes y respuestas
  'openid', 'email',
].join(' ');

// Las claves del cliente OAuth de Google: de los secretos del servidor o de los Ajustes (guardadas en tu propia base).
export const credenciales = (env, c = {}) => ({ id: env.GOOGLE_CLIENT_ID || c.google_client_id || '', secreto: env.GOOGLE_CLIENT_SECRET || c.google_client_secret || '' });
export const gmailConfigurado = (env, c) => { const k = credenciales(env, c); return Boolean(k.id && k.secreto); };

export async function urlConsentimiento(env, db, base) {
  const estado = token(20);
  const k = credenciales(env, await leerConfig(db));
  await guardarConfig(db, 'gmail_estado', estado);
  const p = new URLSearchParams({
    client_id: k.id,
    redirect_uri: `${base}/api/gmail/vuelta`,
    response_type: 'code',
    scope: ALCANCES,
    access_type: 'offline',
    prompt: 'consent',
    state: estado,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

export async function completarConexion(env, db, base, code, estado) {
  const c = await leerConfig(db);
  if (!estado || estado !== c.gmail_estado) throw new Error('El permiso venció, probá conectar de nuevo.');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: credenciales(env, c).id, client_secret: credenciales(env, c).secreto,
      redirect_uri: `${base}/api/gmail/vuelta`, grant_type: 'authorization_code',
    }),
  });
  const t = await r.json();
  if (!r.ok || !t.refresh_token) throw new Error(t.error_description || t.error || 'Google no devolvió el permiso.');
  const perfil = await (await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
    headers: { authorization: `Bearer ${t.access_token}` },
  })).json();
  await guardarConfig(db, 'gmail_refresh', t.refresh_token);
  await guardarConfig(db, 'gmail_acceso', t.access_token);
  await guardarConfig(db, 'gmail_vence', Date.now() + (t.expires_in - 120) * 1000);
  await guardarConfig(db, 'gmail_email', perfil.emailAddress || '');
  await guardarConfig(db, 'gmail_estado', '');
  return perfil.emailAddress;
}

export async function desconectar(db) {
  cache = { token: '', vence: 0 };
  for (const k of ['gmail_refresh', 'gmail_acceso', 'gmail_vence', 'gmail_email']) await guardarConfig(db, k, '');
}

// El permiso de acceso dura ~1 hora: se guarda en memoria para no leer la base en cada mail.
let cache = { token: '', vence: 0 };
async function tokenAcceso(env, db, c) {
  if (cache.token && cache.vence > Date.now()) return cache.token;
  c = c || await leerConfig(db);
  if (!c.gmail_refresh) throw new Error('Gmail no está conectado');
  if (c.gmail_acceso && Number(c.gmail_vence) > Date.now()) { cache = { token: c.gmail_acceso, vence: Number(c.gmail_vence) }; return cache.token; }
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: credenciales(env, c).id, client_secret: credenciales(env, c).secreto,
      refresh_token: c.gmail_refresh, grant_type: 'refresh_token',
    }),
  });
  const t = await r.json();
  if (!r.ok) {
    if (t.error === 'invalid_grant') await guardarConfig(db, 'gmail_refresh', ''); // permiso revocado
    throw new Error('Gmail: ' + (t.error_description || t.error));
  }
  cache = { token: t.access_token, vence: Date.now() + (t.expires_in - 120) * 1000 };
  await db.batch([
    sentencia(db, "INSERT INTO config (clave, valor) VALUES ('gmail_acceso', ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor", cache.token),
    sentencia(db, "INSERT INTO config (clave, valor) VALUES ('gmail_vence', ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor", String(cache.vence)),
  ]);
  return cache.token;
}

async function api(env, db, ruta, opciones = {}, c) {
  const acceso = await tokenAcceso(env, db, c);
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${ruta}`, {
    ...opciones,
    headers: { authorization: `Bearer ${acceso}`, 'content-type': 'application/json', ...(opciones.headers || {}) },
  });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401) cache = { token: '', vence: 0 };
  if (!r.ok) throw new Error(d.error?.message || `Gmail respondió ${r.status}`);
  return d;
}

export const enviarRaw = (env, db, raw, c) =>
  api(env, db, 'messages/send', { method: 'POST', body: JSON.stringify({ raw }) }, c);

const MAX_LEIDOS = 12; // mensajes de la bandeja que se leen por pasada (cada uno es una llamada a Gmail)
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

// Revisa rebotes («Mail Delivery Subsystem») y respuestas de contactos. Corre en cada pasada y procesa de a poco:
// - Rebote de un USUARIO (gente que descargó tu música): se lo borra, así no vuelve a perjudicar a tu Gmail.
// - Rebote de un CONTACTO (DJ, sello…): se lo marca «Rebotó» (no se borra, para que revises el mail).
// - Respuesta: se anota en la campaña y no se le manda el recordatorio. Si el asunto es «baja», se lo da de baja.
export async function revisarBandeja(env, db, c) {
  c = c || await leerConfig(db);
  if (!c.gmail_refresh) return { rebotes: 0, respuestas: 0, llamadas: 0 };
  const yo = (c.gmail_email || '').toLowerCase();
  let llamadas = 0;
  const listar = async (q, max) => { llamadas++; return (await api(env, db, `messages?maxResults=${max}&q=${encodeURIComponent(q)}`, {}, c)).messages || []; };
  const rebotes = await listar('from:(mailer-daemon OR postmaster) newer_than:10d', 300);
  const entrantes = await listar('in:inbox newer_than:4d -from:me -from:(mailer-daemon OR postmaster)', 100);
  const todosIds = [...rebotes.map((m) => m.id), ...entrantes.map((m) => m.id)];
  if (!todosIds.length) return { rebotes: 0, respuestas: 0, llamadas };
  const vistos = new Set((await todos(db, 'SELECT id FROM gmail_vistos WHERE id IN (SELECT value FROM json_each(?))', JSON.stringify(todosIds))).map((x) => x.id));
  const nuevosRebotes = rebotes.filter((m) => !vistos.has(m.id)).slice(0, MAX_LEIDOS);
  const nuevosEntrantes = entrantes.filter((m) => !vistos.has(m.id)).slice(0, Math.max(0, MAX_LEIDOS - nuevosRebotes.length));

  const leidos = []; // { id, tipo, emails[], resumen }
  for (const m of nuevosRebotes) {
    llamadas++;
    const full = await api(env, db, `messages/${m.id}?format=full`, {}, c);
    const cab = Object.fromEntries((full.payload?.headers || []).map((h) => [h.name.toLowerCase(), h.value]));
    const emails = cab['x-failed-recipients'] ? cab['x-failed-recipients'].split(',') : (textoDe(full.payload) + ' ' + (full.snippet || '')).match(EMAIL) || [];
    leidos.push({ id: m.id, tipo: 'rebote', emails: [...new Set(emails.map((e) => e.trim().toLowerCase()))].filter((e) => e && e !== yo), resumen: (full.snippet || '').slice(0, 200) });
  }
  for (const m of nuevosEntrantes) {
    llamadas++;
    const meta = await api(env, db, `messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`, {}, c);
    const cab = Object.fromEntries((meta.payload?.headers || []).map((h) => [h.name.toLowerCase(), h.value]));
    const de = ((cab.from || '').match(EMAIL) || [''])[0].toLowerCase();
    leidos.push({ id: m.id, tipo: /^\s*baja\s*$/i.test(cab.subject || '') ? 'baja' : 'respuesta', emails: de ? [de] : [], resumen: `${cab.subject || ''} — ${meta.snippet || ''}`.slice(0, 300) });
  }
  const st = procesarLeidos(db, leidos, await contactosPorEmail(db, leidos));
  await enLotes(db, st.sentencias);
  const pendientes = rebotes.filter((m) => !vistos.has(m.id)).length - nuevosRebotes.length;
  return { rebotes: st.rebotes, usuariosBorrados: st.borrados, respuestas: st.respuestas, llamadas, pendientes: Math.max(0, pendientes) };
}

// Una sola consulta para saber a qué contactos corresponden los mails leídos
export async function contactosPorEmail(db, leidos) {
  const emails = [...new Set(leidos.flatMap((l) => l.emails))];
  const filas = emails.length ? await todos(db, 'SELECT id, email, lista FROM contactos WHERE email IN (SELECT value FROM json_each(?))', JSON.stringify(emails)) : [];
  return new Map(filas.map((x) => [x.email.toLowerCase(), x]));
}

// Arma todas las sentencias (se ejecutan juntas en un lote). Separado para poder probarlo sin Gmail.
export function procesarLeidos(db, leidos, porEmail, ahora = Date.now()) {
  const st = [];
  let rebotes = 0, respuestas = 0, borrados = 0;
  const ultimoEnvio = "(SELECT id FROM envios WHERE contacto_id = ? AND estado IN ('enviado','rebotado') ORDER BY enviado DESC LIMIT 1)";
  for (const l of leidos) {
    for (const e of l.emails) {
      const ct = porEmail.get(e);
      if (!ct) continue;
      if (l.tipo === 'rebote') {
        rebotes++;
        st.push(sentencia(db, `UPDATE envios SET estado = 'rebotado' WHERE id = ${ultimoEnvio}`, ct.id));
        st.push(sentencia(db, "UPDATE envios SET estado = 'cancelado', error = 'el mail rebotó' WHERE contacto_id = ? AND estado = 'pendiente'", ct.id));
        if (ct.lista === 'usuarios') {
          // Se borra el usuario. El evento queda sin contacto pero con el mail, para que se vea en la actividad.
          st.push(sentencia(db, `INSERT INTO eventos (envio_id, contacto_id, campania_id, tipo, ts, detalle)
            SELECT id, NULL, campania_id, 'rebote', ?, ? FROM envios WHERE contacto_id = ? ORDER BY enviado DESC LIMIT 1`, ahora, `${e} no existe: usuario borrado`, ct.id));
          st.push(sentencia(db, 'DELETE FROM grupo_contactos WHERE contacto_id = ?', ct.id));
          st.push(sentencia(db, 'DELETE FROM eventos WHERE contacto_id = ?', ct.id));
          st.push(sentencia(db, 'UPDATE envios SET contacto_id = -contacto_id WHERE contacto_id = ?', ct.id)); // conserva las estadísticas de la campaña
          st.push(sentencia(db, 'DELETE FROM contactos WHERE id = ?', ct.id));
          borrados++;
        } else {
          st.push(sentencia(db, "UPDATE contactos SET estado = 'rebotado', actualizado = ? WHERE id = ?", ahora, ct.id));
          st.push(sentencia(db, `INSERT INTO eventos (envio_id, contacto_id, campania_id, tipo, ts, detalle)
            SELECT id, contacto_id, campania_id, 'rebote', ?, ? FROM envios WHERE contacto_id = ? ORDER BY enviado DESC LIMIT 1`, ahora, l.resumen, ct.id));
        }
      } else if (l.tipo === 'baja') {
        st.push(sentencia(db, "UPDATE contactos SET estado = 'baja', actualizado = ? WHERE id = ?", ahora, ct.id));
        st.push(sentencia(db, "UPDATE envios SET estado = 'cancelado' WHERE contacto_id = ? AND estado = 'pendiente'", ct.id));
        st.push(eventoSql(db, { contacto_id: ct.id, tipo: 'baja', detalle: 'Pidió la baja por mail', ts: ahora }));
      } else {
        respuestas++;
        const ult = `(SELECT id FROM envios WHERE contacto_id = ${Number(ct.id)} AND estado = 'enviado' AND enviado > ${ahora - 45 * 864e5} ORDER BY enviado DESC LIMIT 1)`;
        st.push(sentencia(db, `UPDATE envios SET respondio = COALESCE(respondio, ?) WHERE id = ${ult}`, ahora));
        st.push(sentencia(db, `UPDATE envios SET estado = 'cancelado' WHERE contacto_id = ? AND tipo = 'recordatorio' AND estado = 'pendiente'
          AND campania_id = (SELECT campania_id FROM envios WHERE id = ${ult})`, ct.id));
        st.push(sentencia(db, `INSERT INTO eventos (envio_id, contacto_id, campania_id, tipo, ts, detalle)
          SELECT id, contacto_id, campania_id, 'respuesta', ?, ? FROM envios WHERE id = ${ult}`, ahora, l.resumen));
      }
    }
    st.push(sentencia(db, 'INSERT OR IGNORE INTO gmail_vistos (id, ts) VALUES (?, ?)', l.id, ahora));
  }
  st.push(sentencia(db, 'DELETE FROM gmail_vistos WHERE ts < ?', ahora - 15 * 864e5));
  return { sentencias: st, rebotes, respuestas, borrados };
}

function textoDe(parte) {
  if (!parte) return '';
  let s = '';
  if (parte.body?.data && /^text\//.test(parte.mimeType || '')) {
    try { s += atob(parte.body.data.replace(/-/g, '+').replace(/_/g, '/')); } catch {}
  }
  for (const p of parte.parts || []) s += ' ' + textoDe(p);
  return s;
}
