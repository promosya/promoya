import { useMemo, useState } from 'react';
import { api, useDatos, useAviso, ir, Modal, ChipContacto, TIPOS, pct, hace } from '../ui.jsx';
import { plantillaContactos, armarXlsx, descargar, leerXlsx, textoDeCsv } from '../planilla.js';

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

const COLUMNAS = {
  nombre: /^(nombre|name|artista|artist|dj|contacto)$/i,
  email: /^(e-?mail|correo|mail)$/i,
  soundcloud: /soundcloud|^sc$/i,
  tipo: /^(tipo|type|rol|categor[ií]a)$/i,
  pais: /^(pa[ií]s|country|ciudad|city)$/i,
  etiquetas: /^(etiquetas?|tags?|g[eé]nero)$/i,
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
  return cuerpo.map((f) => Object.fromEntries(Object.entries(mapa).map(([k, i]) => [k, (f[i] || '').trim()])));
}

export function FormContacto({ inicial = {}, onGuardado, onCancelar }) {
  const avisar = useAviso();
  const [f, setF] = useState({ nombre: '', email: '', soundcloud: '', tipo: 'dj', pais: '', etiquetas: '', notas: '', estado: 'activo', ...inicial });
  const [guardando, setGuardando] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
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
        <div className="campo"><label htmlFor="cn">Nombre / artista</label><input id="cn" type="text" value={f.nombre} onChange={set('nombre')} autoFocus /></div>
        <div className="campo"><label htmlFor="ce">Email</label><input id="ce" type="email" required value={f.email} onChange={set('email')} /></div>
      </div>
      <div className="campo">
        <label htmlFor="cs">Usuario de SoundCloud</label>
        <input id="cs" type="text" value={f.soundcloud} onChange={set('soundcloud')} placeholder="soundcloud.com/usuario o @usuario" />
        <span className="ayuda">Con esto la plataforma sabe que, si ese usuario aparece escuchando en SoundCloud, es este contacto.</span>
      </div>
      <div className="fila">
        <div className="campo"><label htmlFor="ct">Tipo</label>
          <select id="ct" value={f.tipo} onChange={set('tipo')}>{Object.entries(TIPOS).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></div>
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

function Importar({ onCerrar, onListo }) {
  const avisar = useAviso();
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
      const r = await api('contactos/importar', { metodo: 'POST', datos: { filas } });
      avisar(`${r.nuevos} nuevos, ${r.actualizados} actualizados${r.errores.length ? `, ${r.errores.length} con error` : ''}`, r.errores.length > 0);
      onListo();
    } catch (e) { avisar(e.message, true); }
    finally { setSubiendo(false); }
  };
  return (
    <Modal titulo="Importar contactos" onCerrar={onCerrar} pie={<>
      <button className="btn fantasma" onClick={onCerrar}>Cancelar</button>
      <button className="btn primario" disabled={!filas.length || subiendo} onClick={importar}>{subiendo ? 'Importando…' : `Importar ${filas.length || ''}`}</button>
    </>}>
      <ol className="instrucciones">
        <li><b>Descargá la planilla base</b> y abrila con Excel o Google Sheets.
          <div style={{ marginTop: 8 }}><button className="btn chico" onClick={bajarPlanilla}>⬇ Descargar planilla (.xlsx)</button></div></li>
        <li>En la hoja <b>Contactos</b>, borrá las dos filas de ejemplo y cargá <b>un contacto por fila</b>, sin cambiar los títulos de la fila 1. Solo el <b>email</b> es obligatorio; cargá también su <b>soundcloud</b> para saber quién te escuchó.</li>
        <li>Guardá el archivo como está (<b>.xlsx</b>). Desde Google Sheets: Archivo → Descargar → Microsoft Excel (.xlsx).</li>
        <li>Elegí el archivo acá abajo, revisá la lista y tocá <b>Importar</b>. Si un email ya estaba cargado, se actualiza (no se duplica).</li>
      </ol>
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

export default function Contactos() {
  const [lista, recargar, error] = useDatos('contactos');
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
        <div><h1>Contactos</h1><p>{lista.length} contactos · {lista.filter((c) => c.estado === 'activo').length} activos</p></div>
        <div className="acciones">
          <button className="btn" onClick={bajarPlanilla} title="Planilla de Excel para completar con tus contactos e importarlos todos de una">⬇ Planilla base</button>
          <button className="btn" onClick={() => exportar(vis)} disabled={!vis.length}>Exportar</button>
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
