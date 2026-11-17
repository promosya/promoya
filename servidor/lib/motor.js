// Motor de difusión: arma la cola de cada campaña, respeta el tope diario y el arranque gradual,
// manda por tandas, crea los recordatorios y elige el asunto ganador.
//
// Límites del plan gratis de Cloudflare (por pasada): 50 consultas a la base (un db.batch() = 1) y
// 50 llamadas a internet (cada mail a Gmail = 1). Todo está armado para quedar bien por debajo.
import { todos, uno, ejec, sentencia, enLotes, eventoSql, leerConfig, guardarConfig, asegurarEsquema } from './db.js';
import { diaAR, horaAR, msDeDiaHoraAR, sumarDias, diasEntre } from './util.js';
import { armarMail, armarMime } from './plantilla.js';
import { enviarRaw, revisarBandeja } from './gmail.js';

const n = (v, d) => (Number.isFinite(Number(v)) && v !== '' ? Number(v) : d);
const MAX_MAILS_POR_PASADA = 28; // deja lugar para revisar la bandeja dentro de las 50 llamadas
const nuevoToken = () => crypto.randomUUID().replace(/-/g, '').slice(0, 18);
const minutoAzar = () => Math.floor(Math.random() * 50);
export const separarListas = (config) => config.separar_listas !== '0';

// Tope de un día concreto, con el arranque gradual (semana 1, 2, 3...).
export function topeParaDia(config, dia) {
  const tope = n(config.tope_diario, 490);
  const escalones = String(config.arranque || '').split(',').map(Number).filter((x) => x > 0);
  if (!escalones.length) return tope;
  const primer = config.primer_envio || dia;
  const semana = Math.max(0, Math.floor(diasEntre(primer, dia) / 7));
  return Math.min(tope, escalones[Math.min(semana, escalones.length - 1)]);
}

export async function cupoDeHoy(db, config, ahora = Date.now()) {
  const hoy = diaAR(ahora);
  const r = await uno(db, "SELECT COUNT(*) AS c FROM envios WHERE enviado >= ? AND estado IN ('enviado','rebotado')", msDeDiaHoraAR(hoy, 0));
  const tope = topeParaDia(config, hoy);
  return { dia: hoy, tope, enviados: r.c, restante: Math.max(0, tope - r.c) };
}

// Mejor hora (Argentina) de cada contacto según sus aperturas y clics. UNA consulta para todos.
async function mejoresHoras(db, config, ids = null) {
  const desde = n(config.hora_desde, 10), hasta = n(config.hora_hasta, 20);
  const filas = ids
    ? await todos(db, "SELECT contacto_id, ts FROM eventos WHERE tipo IN ('apertura','clic') AND contacto_id IN (SELECT value FROM json_each(?)) AND ts > ?", JSON.stringify(ids), Date.now() - 365 * 864e5)
    : await todos(db, "SELECT contacto_id, ts FROM eventos WHERE tipo IN ('apertura','clic') AND ts > ?", Date.now() - 365 * 864e5);
  const por = new Map();
  for (const f of filas) {
    if (!por.has(f.contacto_id)) por.set(f.contacto_id, {});
    const c = por.get(f.contacto_id); const h = horaAR(f.ts); c[h] = (c[h] || 0) + 1;
  }
  const mapa = new Map();
  for (const [id, cuenta] of por) {
    const total = Object.values(cuenta).reduce((a, b) => a + b, 0);
    if (total < 2) continue;
    const mejor = Object.entries(cuenta).sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0] | 0;
    mapa.set(id, Math.min(hasta - 1, Math.max(desde, mejor)));
  }
  const defecto = n(config.hora_envio, 11);
  return (id) => mapa.get(id) ?? defecto;
}

// Para la ficha de un contacto
export async function mejorHora(db, contactoId, config) {
  const h = await mejoresHoras(db, config, [contactoId]);
  const hora = h(contactoId);
  return { hora, aprendida: hora !== n(config.hora_envio, 11) };
}

// Cuántos mails hay ya programados o enviados por día y por lista (desde ayer). UNA consulta.
async function ocupacionPorDia(db) {
  const filas = await todos(db, `SELECT date((COALESCE(e.enviado, e.programado) - 10800000) / 1000, 'unixepoch') AS dia, ct.lista, COUNT(*) AS n
    FROM envios e JOIN contactos ct ON ct.id = e.contacto_id
    WHERE e.estado IN ('pendiente','enviado') AND COALESCE(e.enviado, e.programado) >= ?
    GROUP BY dia, ct.lista`, Date.now() - 2 * 864e5);
  const oc = new Map();
  for (const f of filas) { if (!oc.has(f.dia)) oc.set(f.dia, {}); oc.get(f.dia)[f.lista] = f.n; }
  return oc;
}

// Elige el día de cada grupo: uno por día desde «desde», sin pasarse del tope del día, y (si está activado)
// sin mezclar contactos y usuarios el mismo día.
function asignarDias(grupos, desde, oc, config) {
  const separar = separarListas(config);
  let cursor = desde;
  const salida = [];
  for (const g of grupos) {
    let dia = cursor;
    for (let intento = 0; intento < 400; intento++) {
      const d = oc.get(dia) || {};
      const otra = Object.entries(d).some(([lista, cant]) => lista !== g.lista && cant > 0);
      const propios = d[g.lista] || 0;
      const tope = topeParaDia(config, dia);
      if (!(separar && otra) && (propios === 0 || propios + g.cantidad <= tope)) break;
      dia = sumarDias(dia, 1);
    }
    if (!oc.has(dia)) oc.set(dia, {});
    oc.get(dia)[g.lista] = (oc.get(dia)[g.lista] || 0) + g.cantidad;
    salida.push({ ...g, dia });
    cursor = sumarDias(dia, 1);
  }
  return salida;
}

// Programa los mails de una lista de grupos (en orden). Lo usan «Activar» y «Reenviar a más grupos».
async function programarGrupos(db, camp, grupos, desde, { config, abPrimerGrupo = false }) {
  const ids = grupos.map((g) => g.grupo_id);
  const [miembros, recibidos] = await db.batch([
    sentencia(db, `SELECT gc.grupo_id, c.id, c.lista FROM grupo_contactos gc JOIN contactos c ON c.id = gc.contacto_id
      WHERE gc.grupo_id IN (SELECT value FROM json_each(?)) AND c.estado = 'activo' ORDER BY c.id`, JSON.stringify(ids)),
    sentencia(db, "SELECT contacto_id FROM envios WHERE campania_id = ? AND tipo = 'principal'", camp.id),
  ]);
  const vistos = new Set(recibidos.results.map((x) => x.contacto_id));
  // Quién le toca a cada grupo (un contacto que está en dos grupos recibe una sola vez, con el primero)
  const porGrupo = new Map(ids.map((id) => [id, []]));
  for (const id of ids) for (const m of miembros.results) {
    if (m.grupo_id !== id || vistos.has(m.id)) continue;
    vistos.add(m.id); porGrupo.get(id).push(m);
  }
  const conCantidad = grupos.map((g) => {
    const ms = porGrupo.get(g.grupo_id);
    const lista = g.lista || (ms.length && ms.every((x) => x.lista === 'usuarios') ? 'usuarios' : 'contactos');
    return { ...g, lista, cantidad: ms.length };
  }).filter((g) => g.cantidad > 0 || g.mantener);
  const hora = await mejoresHoras(db, config, conCantidad.flatMap((g) => porGrupo.get(g.grupo_id).map((m) => m.id)));
  const conDia = asignarDias(conCantidad, desde, await ocupacionPorDia(db), config);
  const st = [];
  let total = 0, alternar = 0;
  for (const g of conDia) {
    st.push(g.nuevo
      ? sentencia(db, 'INSERT OR IGNORE INTO campania_grupos (campania_id, grupo_id, orden, dia) VALUES (?, ?, ?, ?)', camp.id, g.grupo_id, g.orden, g.dia)
      : sentencia(db, 'UPDATE campania_grupos SET dia = ? WHERE campania_id = ? AND grupo_id = ?', g.dia, camp.id, g.grupo_id));
    const primero = abPrimerGrupo && g === conDia[0];
    for (const m of porGrupo.get(g.grupo_id)) {
      const variante = camp.asunto_b && primero ? (alternar++ % 2 ? 'B' : 'A') : null;
      st.push(sentencia(db, `INSERT OR IGNORE INTO envios (token, campania_id, contacto_id, grupo_id, tipo, variante, programado)
        VALUES (?, ?, ?, ?, 'principal', ?, ?)`, nuevoToken(), camp.id, m.id, g.grupo_id, variante, msDeDiaHoraAR(g.dia, hora(m.id), minutoAzar())));
      total++;
    }
  }
  return { st, total, detalle: conDia.map((g) => ({ grupo: g.nombre, lista: g.lista, dia: g.dia, mails: g.cantidad })) };
}

// Al activar: un grupo por día desde la fecha de inicio.
export async function planificarCampania(db, campaniaId) {
  const config = await leerConfig(db);
  const camp = await uno(db, 'SELECT * FROM campanias WHERE id = ?', campaniaId);
  if (!camp) throw new Error('No existe la campaña');
  const grupos = await todos(db, `SELECT cg.grupo_id, cg.orden, g.nombre, g.lista FROM campania_grupos cg JOIN grupos g ON g.id = cg.grupo_id
    WHERE cg.campania_id = ? ORDER BY cg.orden`, campaniaId);
  if (!grupos.length) throw new Error('Elegí al menos un grupo');
  const hoy = diaAR();
  const inicio = camp.inicio && camp.inicio >= hoy ? camp.inicio : hoy;
  const { st, total, detalle } = await programarGrupos(db, camp, grupos.map((g) => ({ ...g, mantener: true })), inicio, { config, abPrimerGrupo: true });
  if (!total) throw new Error('Esos grupos no tienen contactos activos');
  st.push(sentencia(db, "UPDATE campanias SET estado = 'activa', inicio = ? WHERE id = ?", inicio, campaniaId));
  await enLotes(db, st);
  return { total, inicio, detalle };
}

// Grupos que se pueden sumar a una campaña ya activada, con cuántos contactos todavía no la recibieron.
export async function candidatosCampania(db, campaniaId) {
  const [ultimo, grupos] = await db.batch([
    sentencia(db, 'SELECT MAX(dia) AS dia FROM campania_grupos WHERE campania_id = ?', campaniaId),
    sentencia(db, `SELECT g.id, g.nombre, g.lista,
        SUM(CASE WHEN c.estado = 'activo' THEN 1 ELSE 0 END) AS activos,
        SUM(CASE WHEN c.estado = 'activo' AND NOT EXISTS (SELECT 1 FROM envios e WHERE e.campania_id = ? AND e.contacto_id = c.id AND e.tipo = 'principal') THEN 1 ELSE 0 END) AS nuevos,
        EXISTS (SELECT 1 FROM campania_grupos cg WHERE cg.campania_id = ? AND cg.grupo_id = g.id) AS en_campania
      FROM grupos g LEFT JOIN grupo_contactos gc ON gc.grupo_id = g.id LEFT JOIN contactos c ON c.id = gc.contacto_id
      GROUP BY g.id ORDER BY g.lista, g.nombre COLLATE NOCASE`, campaniaId, campaniaId),
  ]);
  const hoy = diaAR();
  const u = ultimo.results[0]?.dia;
  const proximo = u && sumarDias(u, 1) > hoy ? sumarDias(u, 1) : hoy;
  return { proximo, hoy, grupos: grupos.results };
}

// Suma grupos a una campaña que ya arrancó. Solo se programa a quien todavía no la recibió
// (así se puede volver a elegir un grupo para mandarle a los contactos que se agregaron después).
export async function agregarGruposCampania(db, campaniaId, grupos, inicio) {
  const config = await leerConfig(db);
  const camp = await uno(db, 'SELECT * FROM campanias WHERE id = ?', campaniaId);
  if (!camp) throw new Error('No existe la campaña');
  if (camp.estado === 'borrador') throw new Error('La campaña todavía no arrancó: elegí los grupos desde «Editar»');
  const ids = [...new Set((grupos || []).map(Number).filter(Boolean))];
  if (!ids.length) throw new Error('Elegí al menos un grupo');
  const hoy = diaAR();
  const desde = /^\d{4}-\d{2}-\d{2}$/.test(inicio || '') && inicio >= hoy ? inicio : (await candidatosCampania(db, campaniaId)).proximo;
  const [info, ya, max] = await db.batch([
    sentencia(db, 'SELECT id, nombre, lista FROM grupos WHERE id IN (SELECT value FROM json_each(?))', JSON.stringify(ids)),
    sentencia(db, 'SELECT grupo_id FROM campania_grupos WHERE campania_id = ?', campaniaId),
    sentencia(db, 'SELECT MAX(orden) AS o FROM campania_grupos WHERE campania_id = ?', campaniaId),
  ]);
  const porId = new Map(info.results.map((g) => [g.id, g]));
  const yaEstan = new Set(ya.results.map((x) => x.grupo_id));
  let orden = (max.results[0]?.o ?? -1) + 1;
  const lista = ids.filter((id) => porId.has(id)).map((id) => ({ grupo_id: id, nombre: porId.get(id).nombre, lista: porId.get(id).lista, nuevo: !yaEstan.has(id), orden: yaEstan.has(id) ? null : orden++ }));
  const { st, total, detalle } = await programarGrupos(db, camp, lista, desde, { config });
  if (!total) throw new Error('Todos los contactos de esos grupos ya recibieron esta campaña');
  // Si estaba terminada, vuelve a enviarse sola. Si estaba pausada, queda pausada hasta que la reanudes.
  if (camp.estado === 'terminada') st.push(sentencia(db, "UPDATE campanias SET estado = 'activa' WHERE id = ?", campaniaId));
  st.push(eventoSql(db, { campania_id: campaniaId, tipo: 'grupos', detalle: detalle.map((d) => `${d.grupo} (${d.mails})`).join(', ') }));
  await enLotes(db, st);
  return { total, desde: detalle[0]?.dia || desde, detalle, pausada: camp.estado === 'pausada' };
}

// Qué lista «es dueña» de un día: la que ya mandó algo ese día; si no, la que tiene mails programados para ese día;
// si no, la del mail más atrasado.
function duenioDelDia(dia, items, yaEnviada) {
  if (yaEnviada) return yaEnviada;
  const deHoy = items.find((p) => p.dia === dia);
  return (deHoy || items[0])?.lista || null;
}

// Proyección de los próximos días: cuántos salen cada día respetando el tope (lo que no entra pasa al día siguiente).
export async function proyectar(db, dias = 21) {
  const config = await leerConfig(db);
  const hoyCupo = await cupoDeHoy(db, config);
  const [pend, hoyLista] = await db.batch([
    sentencia(db, `SELECT e.programado, e.tipo, c.nombre, ct.lista FROM envios e JOIN campanias c ON c.id = e.campania_id JOIN contactos ct ON ct.id = e.contacto_id
      WHERE e.estado = 'pendiente' AND c.estado = 'activa' ORDER BY (e.tipo = 'recordatorio'), e.programado`),
    sentencia(db, "SELECT ct.lista FROM envios e JOIN contactos ct ON ct.id = e.contacto_id WHERE e.enviado >= ? AND e.estado IN ('enviado','rebotado') LIMIT 1", msDeDiaHoraAR(hoyCupo.dia, 0)),
  ]);
  const separar = separarListas(config);
  const salida = [];
  let cola = pend.results.map((p) => ({ ...p, dia: diaAR(p.programado) }));
  for (let i = 0; i < dias; i++) {
    const dia = sumarDias(hoyCupo.dia, i);
    const tope = i === 0 ? hoyCupo.restante : topeParaDia({ ...config, primer_envio: config.primer_envio || hoyCupo.dia }, dia);
    let listos = cola.filter((p) => p.dia <= dia);
    const lista = duenioDelDia(dia, listos, i === 0 ? hoyLista.results[0]?.lista : null);
    if (separar && lista) listos = listos.filter((p) => p.lista === lista);
    const salen = listos.slice(0, tope);
    const fuera = new Set(salen);
    cola = cola.filter((p) => !fuera.has(p));
    const porCampania = {};
    for (const s of salen) porCampania[s.nombre] = (porCampania[s.nombre] || 0) + 1;
    salida.push({ dia, lista: salen.length || (i === 0 && hoyCupo.enviados) ? lista : null, tope: i === 0 ? hoyCupo.tope : tope, ya: i === 0 ? hoyCupo.enviados : 0, salen: salen.length, atrasados: Math.max(0, listos.length - salen.length), porCampania });
  }
  return salida;
}

// Una pasada del motor, registrando cuándo fue y qué hizo (se ve en Resumen).
export async function pasada(env, { base, origen, forzarVentana = false, db = env.DB } = {}) {
  await asegurarEsquema(db);
  const config = await leerConfig(db);
  base = base || env.BASE_URL || config.base_url;
  if (!base) return { sinDireccion: true };
  let r;
  try { r = await tick(env, db, { base, forzarVentana, config }); }
  catch (e) { r = { error: e.message }; }
  await db.batch([
    sentencia(db, "INSERT INTO config (clave, valor) VALUES ('ultimo_tick', ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor", String(Date.now())),
    sentencia(db, "INSERT INTO config (clave, valor) VALUES ('ultimo_tick_res', ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor", JSON.stringify({ ...r, origen, ts: Date.now() })),
  ]);
  return r;
}

// ---- La pasada del cron (cada 10 minutos) ----
export async function tick(env, db, { base, forzarVentana = false, config } = {}) {
  const ahora = Date.now();
  config = config || await leerConfig(db);
  const res = { enviados: 0, errores: 0, recordatorios: 0, ganadores: 0, terminadas: 0 };
  const conGmail = Boolean(config.gmail_refresh);
  const prueba = env.MODO_PRUEBA === '1';
  let llamadas = 0; // llamadas a Gmail en esta pasada (máximo 50 en el plan gratis)

  await crearRecordatorios(db, config, ahora, res);
  await elegirGanadores(db, ahora, res);

  if (conGmail) {
    try { const b = await revisarBandeja(env, db, config); llamadas += b.llamadas || 0; res.bandeja = b; }
    catch (e) { res.bandejaError = e.message; llamadas += 3; }
  }

  const h = horaAR(ahora);
  const desdeH = n(config.hora_desde, 10), hastaH = n(config.hora_hasta, 20);
  if (!((h >= desdeH && h < hastaH) || forzarVentana)) { res.fueraDeHorario = true; await cerrarCampanias(db, ahora, res); return res; }
  if (!conGmail && !prueba) { res.sinGmail = true; return res; }

  const hoy = diaAR(ahora);
  const inicioHoy = msDeDiaHoraAR(hoy, 0);
  const [cuenta, listaHoy, listaProgramada] = await db.batch([
    sentencia(db, "SELECT COUNT(*) AS c FROM envios WHERE enviado >= ? AND estado IN ('enviado','rebotado')", inicioHoy),
    sentencia(db, "SELECT ct.lista FROM envios e JOIN contactos ct ON ct.id = e.contacto_id WHERE e.enviado >= ? AND e.estado IN ('enviado','rebotado') ORDER BY e.enviado LIMIT 1", inicioHoy),
    sentencia(db, `SELECT ct.lista, e.programado FROM envios e JOIN campanias c ON c.id = e.campania_id JOIN contactos ct ON ct.id = e.contacto_id
      WHERE e.estado = 'pendiente' AND c.estado = 'activa' AND ct.estado = 'activo' AND e.programado <= ?
      ORDER BY (e.programado >= ?) DESC, e.programado LIMIT 1`, ahora, inicioHoy),
  ]);
  const tope = topeParaDia(config, hoy);
  const enviadosHoy = cuenta.results[0].c;
  const restante = Math.max(0, tope - enviadosHoy);
  res.cupo = { dia: hoy, tope, enviados: enviadosHoy, restante };
  if (restante <= 0) { res.topeAlcanzado = true; await cerrarCampanias(db, ahora, res); return res; }

  // Contactos y usuarios nunca el mismo día: la lista del día es la que ya mandó hoy o la que tiene mails programados para hoy.
  const lista = separarListas(config) ? (listaHoy.results[0]?.lista || listaProgramada.results[0]?.lista || null) : null;
  res.lista = lista;

  // Tanda: lo necesario para llegar al tope antes de que cierre el horario, sin pasarse de lo que permite Cloudflare.
  const pasadasQuedan = Math.max(1, Math.ceil((msDeDiaHoraAR(hoy, hastaH) - ahora) / 600000));
  const limite = Math.max(0, Math.min(restante, MAX_MAILS_POR_PASADA, 46 - llamadas, Math.max(n(config.tanda, 8), Math.ceil(restante / pasadasQuedan))));
  if (!limite) return res;

  const [cola, camps] = await db.batch([
    sentencia(db, `SELECT e.*, ct.nombre AS ct_nombre, ct.email AS ct_email, ct.estado AS ct_estado, ct.lista AS ct_lista,
        (SELECT p.asunto FROM envios p WHERE p.campania_id = e.campania_id AND p.contacto_id = e.contacto_id AND p.tipo = 'principal') AS asunto_original
      FROM envios e JOIN campanias c ON c.id = e.campania_id JOIN contactos ct ON ct.id = e.contacto_id
      WHERE e.estado = 'pendiente' AND c.estado = 'activa' AND e.programado <= ? AND (? IS NULL OR ct.lista = ?)
      ORDER BY (e.tipo = 'recordatorio'), e.programado LIMIT ?`, ahora, lista, lista, limite),
    sentencia(db, "SELECT * FROM campanias WHERE estado = 'activa'"),
  ]);
  const campanias = new Map(camps.results.map((c) => [c.id, c]));
  const st = [];
  let primerEnvio = config.primer_envio;
  for (const envio of cola.results) {
    const camp = campanias.get(envio.campania_id);
    if (envio.ct_estado !== 'activo') { st.push(sentencia(db, "UPDATE envios SET estado = 'cancelado', error = 'contacto no activo' WHERE id = ?", envio.id)); continue; }
    if (envio.tipo === 'principal' && !envio.variante) envio.variante = camp.asunto_b ? (camp.ab_ganador || (envio.id % 2 ? 'B' : 'A')) : 'A';
    const ct = { id: envio.contacto_id, nombre: envio.ct_nombre, email: envio.ct_email, lista: envio.ct_lista };
    const mail = armarMail({ campania: camp, contacto: ct, envio, config, base });
    try {
      let id = 'prueba-' + envio.token, hilo = null;
      if (conGmail) {
        const raw = armarMime({ de: config.gmail_email, deNombre: config.remitente_nombre || config.gmail_email, para: ct.email, paraNombre: ct.nombre, ...mail });
        const r = await enviarRaw(env, db, raw, config);
        id = r.id; hilo = r.threadId;
      }
      const t = Date.now();
      st.push(sentencia(db, "UPDATE envios SET estado = 'enviado', enviado = ?, gmail_id = ?, gmail_hilo = ?, variante = ?, asunto = ?, error = NULL WHERE id = ?", t, id, hilo, envio.variante, mail.asunto, envio.id));
      st.push(eventoSql(db, { envio_id: envio.id, contacto_id: ct.id, campania_id: camp.id, tipo: envio.tipo === 'recordatorio' ? 'recordatorio' : 'envio', detalle: mail.asunto, ts: t }));
      if (!primerEnvio) { primerEnvio = diaAR(t); st.push(sentencia(db, "INSERT INTO config (clave, valor) VALUES ('primer_envio', ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor", primerEnvio)); }
      res.enviados++;
    } catch (e) {
      res.errores++;
      st.push(sentencia(db, "UPDATE envios SET estado = 'error', error = ? WHERE id = ?", String(e.message).slice(0, 300), envio.id));
      if (/no está conectado|invalid_grant|401|403|429|Rate|limit/i.test(e.message)) { res.frenado = e.message; break; }
    }
  }
  if (st.length) await enLotes(db, st);
  await cerrarCampanias(db, ahora, res);
  return res;
}

async function crearRecordatorios(db, config, ahora, res) {
  const cand = await todos(db, `SELECT e.campania_id, e.contacto_id, e.grupo_id FROM envios e JOIN campanias c ON c.id = e.campania_id
    WHERE e.tipo = 'principal' AND e.estado = 'enviado' AND c.estado = 'activa' AND c.recordatorio_dias > 0
      AND e.abierto IS NULL AND e.clic IS NULL AND e.respondio IS NULL AND e.escuchado IS NULL
      AND e.enviado + c.recordatorio_dias * 86400000 <= ?
      AND NOT EXISTS (SELECT 1 FROM envios r WHERE r.campania_id = e.campania_id AND r.contacto_id = e.contacto_id AND r.tipo = 'recordatorio')
    LIMIT 1000`, ahora);
  if (!cand.length) return;
  const hora = await mejoresHoras(db, config, cand.map((c) => c.contacto_id));
  const hoy = diaAR(ahora);
  await enLotes(db, cand.map((c) => {
    const h = hora(c.contacto_id);
    const dia = msDeDiaHoraAR(hoy, h) < ahora ? sumarDias(hoy, 1) : hoy;
    return sentencia(db, "INSERT OR IGNORE INTO envios (token, campania_id, contacto_id, grupo_id, tipo, programado) VALUES (?, ?, ?, ?, 'recordatorio', ?)",
      nuevoToken(), c.campania_id, c.contacto_id, c.grupo_id, msDeDiaHoraAR(dia, h, minutoAzar()));
  }));
  res.recordatorios = cand.length;
}

// Asunto A/B: cuando el primer grupo lleva 24 h enviado, gana el que más abrieron (o tocaron).
async function elegirGanadores(db, ahora, res) {
  const filas = await todos(db, `SELECT e.campania_id, e.variante, COUNT(*) AS env, SUM(CASE WHEN e.abierto IS NOT NULL OR e.clic IS NOT NULL THEN 1 ELSE 0 END) AS ab,
      SUM(CASE WHEN e.estado = 'pendiente' THEN 1 ELSE 0 END) AS pend, MAX(e.enviado) AS ultimo
    FROM envios e JOIN campanias c ON c.id = e.campania_id
    WHERE c.estado = 'activa' AND c.asunto_b != '' AND c.ab_ganador IS NULL AND e.tipo = 'principal' AND e.variante IN ('A','B')
    GROUP BY e.campania_id, e.variante`);
  const por = new Map();
  for (const f of filas) { if (!por.has(f.campania_id)) por.set(f.campania_id, []); por.get(f.campania_id).push(f); }
  const st = [];
  for (const [id, r] of por) {
    if (r.length < 2 || r.some((x) => x.pend > 0) || r.some((x) => !x.ultimo || x.ultimo > ahora - 864e5)) continue;
    const tasa = (v) => { const x = r.find((y) => y.variante === v); return x.env ? x.ab / x.env : 0; };
    const ganador = tasa('B') > tasa('A') ? 'B' : 'A';
    st.push(sentencia(db, 'UPDATE campanias SET ab_ganador = ? WHERE id = ?', ganador, id));
    st.push(eventoSql(db, { campania_id: id, tipo: 'ab', detalle: `Ganó el asunto ${ganador} (A ${Math.round(tasa('A') * 100)}% · B ${Math.round(tasa('B') * 100)}%)` }));
    res.ganadores++;
  }
  if (st.length) await enLotes(db, st);
}

async function cerrarCampanias(db, ahora, res) {
  const camps = await todos(db, `SELECT c.id, c.recordatorio_dias,
      (SELECT COUNT(*) FROM envios e WHERE e.campania_id = c.id AND e.estado = 'pendiente') AS pend,
      (SELECT MAX(enviado) FROM envios e WHERE e.campania_id = c.id AND e.tipo = 'principal') AS ultimo
    FROM campanias c WHERE c.estado = 'activa'`);
  const ids = camps.filter((c) => c.pend === 0 && c.ultimo && !(c.recordatorio_dias > 0 && c.ultimo + (c.recordatorio_dias + 1) * 864e5 > ahora)).map((c) => c.id);
  if (!ids.length) return;
  await ejec(db, "UPDATE campanias SET estado = 'terminada' WHERE id IN (SELECT value FROM json_each(?))", JSON.stringify(ids));
  res.terminadas = ids.length;
}

// Contactos fríos: las últimas N promos que recibió no las abrió, ni tocó, ni respondió.
export async function contactosFrios(db, config) {
  const N = n(config.frio_promos, 3);
  const filas = await todos(db, `SELECT contacto_id,
      MAX(abierto IS NOT NULL OR clic IS NOT NULL OR escuchado IS NOT NULL OR respondio IS NOT NULL) AS senal,
      MAX(CASE WHEN tipo = 'principal' THEN enviado END) AS cuando
    FROM envios WHERE estado = 'enviado' GROUP BY contacto_id, campania_id
    HAVING cuando IS NOT NULL AND cuando < ? ORDER BY contacto_id, cuando DESC`, Date.now() - 2 * 864e5);
  const por = new Map();
  for (const f of filas) { if (!por.has(f.contacto_id)) por.set(f.contacto_id, []); por.get(f.contacto_id).push(f.senal); }
  const frios = new Set();
  for (const [id, s] of por) if (s.length >= N && s.slice(0, N).every((x) => !x)) frios.add(id);
  return frios;
}
