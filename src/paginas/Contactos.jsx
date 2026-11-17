import { useMemo, useState } from 'react';
import { api, useDatos, useAviso, ir, Modal, ChipContacto, TIPOS, pct, hace } from '../ui.jsx';
import { plantillaContactos, plantillaSellos, armarXlsx, descargar, leerXlsx, textoDeCsv } from '../planilla.js';

// CSV/TSV simple con comillas
function parsearCSV(txt) {
  const sep = [',', ';', '\t'].map((s) => [s, (txt.split('\n')[0].match(new RegExp(s === '\t' ? '\t' : `\\${s}`, 'g')) || []).length]).sort((a, b) => b[1] - a[1])[0][0];
  const filas = []; let fila = [], campo = '', comillas = false;
  for (let i = 0; i < txt.length; i++) {
    const ch = txt[i];
    if (comillas) {
      if (ch === '"' && txt[i + 1] === '"') { campo += '"'; i++; }
      else if (ch === '"') comillas = false;
      else campo += ch;
    } else if (ch === '"') comillas = true;
    else if (ch === sep) { fila.push(campo); campo = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && txt[i + 1] === '\n') i++; fila.push(campo); filas.push(fila); fila = []; campo = ''; }
    else campo += ch;
  }
  if (campo || fila.length) { fila.push(campo); filas.push(fila); }
  return filas.filter((f) => f.some((x) => x.trim()));
}

// Títulos de columna que se reconocen (en castellano, inglés y los que exportan Hypeddit y similares)
const COLUMNAS = {
  nombre: /^(nombre|name|full ?name|nombre completo|first ?name|artista|artist|dj|contacto|username|usuario)$/i,
  email: /^(e-?mail|correo|mail|e-?mail address|direcci[oó]n de correo)$/i,
  soundcloud: /soundcloud|^sc$/i,
  tipo: /^(tipo|type|rol|categor[ií]a)$/i,
  pais: /^(pa[ií]s|country|ciudad|city|location|ubicaci[oó]n)$/i,
  etiquetas: /^(etiquetas?|tags?|g[eé]nero)$/i,
  origen: /^(track|tema|lanzamiento|release|gate|download|descarga|campaign|campa[ñn]a|fuente|source|title|t[ií]tulo|product)( ?name| ?title)?$/i,
  notas: /^(notas?|notes?|comentarios?)$/i,
};

const filasDeCSV = (txt) => filasDeTabla(parsearCSV(txt.trim()));

// Convierte una tabla (de Excel o CSV) en contactos, reconociendo las columnas por su título
function filasDeTabla(t) {
  t = t.map((f) => f.map((x) => String(x ?? '')));
  if (!t.length) return [];
  const cab = t[0].map((h) => h.trim());
  const mapa = {};
  cab.forEach((h, i) => { for (const [k, re] of Object.entries(COLUMNAS)) if (re.test(h) && mapa[k] === undefined) mapa[k] = i; });
  let cuerpo = t.slice(1);
  if (mapa.email === undefined) {
    // Sin encabezado: buscar la columna con @
    const i = t[0].findIndex((x) => x.includes('@'));
    if (i < 0) return [];
    mapa.email = i; cuerpo = t;
    const sc = t[0].findIndex((x) => /soundcloud\.com/i.test(x));
    if (sc >= 0) mapa.soundcloud = sc;
    const nom = t[0].findIndex((x, j) => j !== i && j !== sc && x.trim());
    if (nom >= 0) mapa.nombre = nom;
  }
  return cuerpo.map((f) => {
    const x = Object.fromEntries(Object.entries(mapa).map(([k, i]) => [k, (f[i] || '').trim()]));
    // El tema que descargó (Hypeddit) queda como etiqueta, para poder armar grupos por lanzamiento
    if (x.origen) { x.etiquetas = [x.etiquetas, x.origen].filter(Boolean).join(', '); delete x.origen; }
    return x;
  });
}

export function FormContacto({ inicial = {}, onGuardado, onCancelar }) {
  const avisar = useAviso();
  const [f, setF] = useState({ nombre: '', email: '', soundcloud: '', tipo: 'dj', pais: '', etiquetas: '', notas: '', estado: 'activo', lista: 'contactos', ...inicial });
  const [guardando, setGuardando] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const sello = f.lista === 'sellos';
  const guardar = async (e) => {
    e.preventDefault();
    setGuardando(true);
    try {
      if (f.id) await api(`contactos/${f.id}`, { metodo: 'PUT', datos: f });
      else await api('contactos', { metodo: 'POST', datos: f });
      avisar('Contacto guardado');
      onGuardado?.();
    } catch (x) { avisar(x.message, true); }
    finally { setGuardando(false); }
  };
  return (
    <form onSubmit={guardar}>
      <div className="fila">
        <div className="campo"><label htmlFor="cn">{sello ? 'Nombre del sello' : 'Nombre / artista'}</label><input id="cn" type="text" value={f.nombre} onChange={set('nombre')} autoFocus /></div>
        <div className="campo"><label htmlFor="ce">{sello ? 'Email para demos' : 'Email'}</label><input id="ce" type="email" required value={f.email} onChange={set('email')} /></div>
      </div>
      {!sello && (
        <div className="campo">
          <label htmlFor="cs">Usuario de SoundCloud</label>
          <input id="cs" type="text" value={f.soundcloud} onChange={set('soundcloud')} placeholder="soundcloud.com/usuario o @usuario" />
          <span className="ayuda">Con esto la plataforma sabe que, si ese usuario aparece escuchando en SoundCloud, es este contacto.</span>
        </div>
      )}
      <div className="fila">
        <div className="campo"><label htmlFor="cli">Lista</label>
          <select id="cli" value={f.lista} onChange={set('lista')}>
            <option value="contactos">Contactos (DJs, radios, prensa)</option>
            <option value="usuarios">Usuarios (descargaron tu música)</option>
            <option value="sellos">Sellos (para mandar demos)</option>
          </select></div>
        {!sello && <div className="campo"><label htmlFor="ct">Tipo</label>
          <select id="ct" value={f.tipo} onChange={set('tipo')}>{Object.entries(TIPOS).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></div>}
        <div className="campo"><label htmlFor="cp">País / ciudad</label><input id="cp" type="text" value={f.pais} onChange={set('pais')} /></div>
        {f.id && <div className="campo"><label htmlFor="cst">Estado</label>
          <select id="cst" value={f.estado} onChange={set('estado')}>
            <option value="activo">Activo</option><option value="pausado">Pausado (no le llegan promos)</option>
            <option value="baja">Se dio de baja</option><option value="rebotado">Rebotó</option>
          </select></div>}
      </div>
      <div className="campo"><label htmlFor="cet">Etiquetas</label><input id="cet" type="text" value={f.etiquetas} onChange={set('etiquetas')} placeholder="tech house, residente, top" /><span className="ayuda">Separadas por coma. Sirven para armar grupos.</span></div>
      <div className="campo"><label htmlFor="cno">Notas</label><textarea id="cno" rows={3} style={{ minHeight: 70 }} value={f.notas} onChange={set('notas')} /></div>
      <div className="pie-modal">
        {onCancelar && <button type="button" className="btn fantasma" onClick={onCancelar}>Cancelar</button>}
        <button className="btn primario" disabled={guardando}>Guardar</button>
      </div>
    </form>
  );
}

export const bajarPlanilla = () => descargar(plantillaContactos(), 'planilla-contactos-promoya.xlsx');
export const bajarPlanillaSellos = () => descargar(plantillaSellos(), 'planilla-sellos-promoya.xlsx');

export function Importar({ onCerrar, onListo, lista = 'contactos' }) {
  const avisar = useAviso();
  const usuarios = lista === 'usuarios';
  const [etiqueta, setEtiqueta] = useState('');
  const [txt, setTxt] = useState('');
  const [deArchivo, setDeArchivo] = useState(null); // contactos leídos de un archivo
  const [nombreArchivo, setNombreArchivo] = useState('');
  const [subiendo, setSubiendo] = useState(false);
  const filas = useMemo(() => (deArchivo ?? filasDeCSV(txt)).filter((f) => f.email || f.nombre), [txt, deArchivo]);
  const conEjemplo = filas.some((f) => /^(dj\.ejemplo@gmail\.com|demos@selloejemplo\.com)$/i.test(f.email));
  const archivo = async (e) => {
    const a = e.target.files[0];
    if (!a) return;
    try {
      if (/\.xls$/i.test(a.name)) throw new Error('Ese Excel es del formato viejo (.xls): guardalo como .xlsx y probá de nuevo');
      const leidas = /\.xlsx$/i.test(a.name) ? filasDeTabla(await leerXlsx(await a.arrayBuffer())) : filasDeCSV(await textoDeCsv(a));
      if (!leidas.length) throw new Error('No encontré contactos: fijate que la planilla tenga la columna «email»');
      setDeArchivo(leidas); setNombreArchivo(a.name); setTxt('');
    } catch (x) { avisar(x.message, true); }
  };
  const importar = async () => {
    setSubiendo(true);
    try {
      const r = await api('contactos/importar', { metodo: 'POST', datos: { filas, lista, etiqueta } });
      const malos = r.totalErrores ?? r.errores.length;
      avisar(`${r.nuevos} nuevos, ${r.actualizados} ya estaban${malos ? `, ${malos} con email inválido (no se cargaron)` : ''}`, false);
      onListo();
    } catch (e) { avisar(e.message, true); }
    finally { setSubiendo(false); }
  };
  return (
    <Modal titulo={{ usuarios: 'Importar usuarios', sellos: 'Importar sellos' }[lista] || 'Importar contactos'} onCerrar={onCerrar} pie={<>
      <button className="btn fantasma" onClick={onCerrar}>Cancelar</button>
      <button className="btn primario" disabled={!filas.length || subiendo} onClick={importar}>{subiendo ? 'Importando…' : `Importar ${filas.length || ''}`}</button>
    </>}>
      {lista === 'sellos' ? (
        <ol className="instrucciones">
          <li><b>Descargá la planilla de sellos</b> y abrila con Excel o Google Sheets.
            <div style={{ marginTop: 8 }}><button className="btn chico" onClick={bajarPlanillaSellos}>⬇ Descargar planilla de sellos (.xlsx)</button></div></li>
          <li>Cargá <b>un sello por fila</b>: el <b>nombre</b> del sello y el <b>email</b> donde reciben demos. País y notas son opcionales.</li>
          <li>Guardala como está (<b>.xlsx</b>), elegila acá abajo y tocá <b>Importar</b>. También sirve cualquier Excel o CSV con columnas «nombre» y «email».</li>
        </ol>
      ) : usuarios ? (
        <>
          <ol className="instrucciones">
            <li>Descargá la lista de gente que bajó tu tema desde <b>Hypeddit</b> (o la plataforma que uses): el archivo <b>CSV o Excel</b> de cada lanzamiento.</li>
            <li>Subilo acá <b>tal cual</b>: reconozco solo las columnas de email, nombre, país y tema. No hace falta tocar nada.</li>
            <li>Si querés, poné de qué lanzamiento son (queda como etiqueta y después podés armar grupos por tema).</li>
            <li>Revisá la lista y tocá <b>Importar</b>. Los mails repetidos se juntan (no se duplican) y los que están mal escritos se descartan.</li>
          </ol>
          <div className="campo">
            <label htmlFor="etq">Lanzamiento (opcional)</label>
            <input id="etq" type="text" value={etiqueta} onChange={(e) => setEtiqueta(e.target.value)} placeholder="Ej: Brother Louie 98 (Movedeck Rework)" />
          </div>
        </>
      ) : (
      <ol className="instrucciones">
        <li><b>Descargá la planilla base</b> y abrila con Excel o Google Sheets.
          <div style={{ marginTop: 8 }}><button className="btn chico" onClick={bajarPlanilla}>⬇ Descargar planilla (.xlsx)</button></div></li>
        <li>En la hoja <b>Contactos</b>, borrá las dos filas de ejemplo y cargá <b>un contacto por fila</b>, sin cambiar los títulos de la fila 1. Solo el <b>email</b> es obligatorio; cargá también su <b>soundcloud</b> para saber quién te escuchó.</li>
        <li>Guardá el archivo como está (<b>.xlsx</b>). Desde Google Sheets: Archivo → Descargar → Microsoft Excel (.xlsx).</li>
        <li>Elegí el archivo acá abajo, revisá la lista y tocá <b>Importar</b>. Si un email ya estaba cargado, se actualiza (no se duplica).</li>
      </ol>
      )}
      <div className="campo">
        <label htmlFor="arch">Archivo (.xlsx o .csv)</label>
        <input id="arch" type="file" accept=".xlsx,.csv,.tsv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={archivo} />
        {nombreArchivo && <span className="ayuda">{nombreArchivo}: {filas.length} contactos. <button type="button" className="btn chico fantasma" onClick={() => { setDeArchivo(null); setNombreArchivo(''); }}>Quitar</button></span>}
      </div>
      {!deArchivo && (
        <details style={{ marginBottom: 12 }}>
          <summary className="sub" style={{ cursor: 'pointer' }}>O pegá la lista (copiada de Excel o separada por comas)</summary>
          <textarea rows={6} style={{ marginTop: 8 }} value={txt} onChange={(e) => setTxt(e.target.value)} placeholder={'nombre,email,soundcloud,tipo\nDJ Fulano,fulano@mail.com,soundcloud.com/djfulano,DJ'} aria-label="Pegar lista" />
        </details>
      )}
      {conEjemplo && <div className="aviso">Quedaron las filas de ejemplo de la planilla («DJ Ejemplo» y «Sello Ejemplo»): borralas del Excel antes de importar.</div>}
      {filas.length > 0 && (
        <div className="tabla-envoltura" style={{ maxHeight: 220 }}>
          <table><thead><tr><th>Nombre</th><th>Email</th><th>SoundCloud</th><th>Tipo</th></tr></thead>
            <tbody>{filas.slice(0, 50).map((f, i) => <tr key={i}><td>{f.nombre}</td><td>{f.email || <span className="chip mal">falta email</span>}</td><td>{f.soundcloud}</td><td>{f.tipo}</td></tr>)}</tbody></table>
        </div>
      )}
      {filas.length > 50 && <p className="sub">… y {filas.length - 50} más.</p>}
    </Modal>
  );
}

function exportar(lista) {
  const cab = ['nombre', 'email', 'soundcloud', 'tipo', 'pais', 'etiquetas', 'notas', 'estado', 'recibidas', 'abiertas', 'clics', 'escuchadas', 'respuestas'];
  const filas = [cab, ...lista.map((c) => cab.map((k) => (k === 'tipo' ? TIPOS[c.tipo] || c.tipo : c[k])))];
  descargar(armarXlsx([{ nombre: 'Contactos', filas, opciones: { anchos: [24, 30, 26, 12, 14, 22, 30, 10, 10, 10, 8, 10, 11] } }]), 'contactos-promoya.xlsx');
}

// Todos juntos (contactos y usuarios) en un Excel simple: una columna con el nombre y otra con el email
export async function exportarNombreEmail(avisar) {
  try {
    const todos = await api('contactos/exportar');
    const filas = [['nombre', 'email'], ...todos.map((c) => [c.nombre, c.email])];
    descargar(armarXlsx([{ nombre: 'Contactos y usuarios', filas, opciones: { anchos: [32, 40] } }]), 'nombres-y-emails-promoya.xlsx');
    avisar?.(`Listo: ${todos.length} en el Excel`);
  } catch (e) { avisar?.(e.message, true); }
}

export default function Contactos() {
  const avisar = useAviso();
  const [lista, recargar, error] = useDatos('contactos?lista=contactos');
  const [modal, setModal] = useState(null);
  const [busca, setBusca] = useState('');
  const [tipo, setTipo] = useState('');
  const [filtro, setFiltro] = useState('todos');
  if (error) return <div className="aviso mal">{error}</div>;
  if (!lista) return <div className="cargando">Cargando…</div>;

  const q = busca.toLowerCase();
  const vis = lista.filter((c) => {
    if (q && !`${c.nombre} ${c.email} ${c.soundcloud} ${c.etiquetas} ${c.pais}`.toLowerCase().includes(q)) return false;
    if (tipo && c.tipo !== tipo) return false;
    if (filtro === 'frios') return c.frio && c.estado === 'activo';
    if (filtro === 'fieles') return c.recibidas >= 2 && c.abiertas / c.recibidas >= 0.6;
    if (filtro === 'sinsc') return !c.soundcloud;
    if (filtro === 'inactivos') return c.estado !== 'activo';
    return true;
  });
  const cuenta = { frios: lista.filter((c) => c.frio && c.estado === 'activo').length, sinsc: lista.filter((c) => !c.soundcloud).length, inactivos: lista.filter((c) => c.estado !== 'activo').length };

  return (
    <>
      <div className="cabecera">
        <div><h1>Contactos</h1><p>DJs, sellos, radios y prensa · {lista.length} contactos · {lista.filter((c) => c.estado === 'activo').length} activos</p></div>
        <div className="acciones">
          <button className="btn" onClick={bajarPlanilla} title="Planilla de Excel para completar con tus contactos e importarlos todos de una">⬇ Planilla base</button>
          <button className="btn" onClick={() => exportarNombreEmail(avisar)} title="Contactos y usuarios juntos, en un Excel con nombre y email">⬇ Nombres y emails (todos)</button>
          <button className="btn" onClick={() => exportar(vis)} disabled={!vis.length} title="Estos contactos con todos sus datos y estadísticas">Exportar detalle</button>
          <button className="btn" onClick={() => setModal('importar')}>Importar</button>
          <button className="btn primario" onClick={() => setModal('nuevo')}>+ Contacto</button>
        </div>
      </div>

      {cuenta.sinsc > 0 && lista.length > 0 && filtro !== 'sinsc' && (
        <div className="aviso info"><span>{cuenta.sinsc} contactos no tienen cargado su usuario de SoundCloud: sin eso no puedo saber si escucharon.</span>
          <button className="btn chico" onClick={() => setFiltro('sinsc')}>Ver cuáles</button></div>
      )}

      <div className="filtros">
        <input type="search" placeholder="Buscar por nombre, mail, SoundCloud, etiqueta…" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar" />
        <select value={tipo} onChange={(e) => setTipo(e.target.value)} aria-label="Tipo"><option value="">Todos los tipos</option>{Object.entries(TIPOS).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select>
        <div className="pestanias">
          {[['todos', 'Todos'], ['fieles', 'Los que más abren'], ['frios', `❄ Fríos (${cuenta.frios})`], ['sinsc', `Sin SoundCloud (${cuenta.sinsc})`], ['inactivos', `Bajas y rebotes (${cuenta.inactivos})`]].map(([k, t]) => (
            <button key={k} className={`pestania ${filtro === k ? 'activa' : ''}`} onClick={() => setFiltro(k)}>{t}</button>
          ))}
        </div>
      </div>

      {!lista.length ? (
        <div className="tarjeta vacio"><b>Cargá tus contactos</b>Descargá la planilla base, completala en Excel y subila: se cargan todos de una. También podés agregarlos de a uno.
          <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className="btn" onClick={bajarPlanilla}>⬇ Descargar planilla</button>
            <button className="btn primario" onClick={() => setModal('importar')}>Importar planilla</button>
          </div></div>
      ) : (
        <div className="tabla-envoltura">
          <table>
            <thead><tr><th>Contacto</th><th>SoundCloud</th><th>Tipo</th><th>Grupos</th><th className="num">Recibió</th><th className="num">Abrió</th><th className="num">Clics</th><th className="num">Escuchó</th><th>Última señal</th><th></th></tr></thead>
            <tbody>
              {vis.map((c) => (
                <tr key={c.id} className="clic" onClick={() => ir(`contactos/${c.id}`)}>
                  <td><b>{c.nombre || '—'}</b><div className="sub">{c.email}</div></td>
                  <td>{c.soundcloud ? <span className="sub">@{c.soundcloud}</span> : <span className="no">—</span>}</td>
                  <td className="sub">{TIPOS[c.tipo] || c.tipo}</td>
                  <td className="sub" style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.grupos || '—'}</td>
                  <td className="num">{c.recibidas}</td>
                  <td className="num">{c.abiertas}{c.recibidas ? <span className="sub"> {pct(c.abiertas, c.recibidas)}%</span> : ''}</td>
                  <td className="num">{c.clics}</td>
                  <td className="num">{c.escuchadas}</td>
                  <td className="sub">{c.ultima ? hace(c.ultima) : '—'}</td>
                  <td><ChipContacto c={c} /></td>
                </tr>
              ))}
              {!vis.length && <tr><td colSpan={10} className="vacio">Nadie con ese filtro.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {modal === 'nuevo' && <Modal titulo="Nuevo contacto" onCerrar={() => setModal(null)}><FormContacto onCancelar={() => setModal(null)} onGuardado={() => { setModal(null); recargar(); }} /></Modal>}
      {modal === 'importar' && <Importar onCerrar={() => setModal(null)} onListo={() => { setModal(null); recargar(); }} />}
    </>
  );
}
