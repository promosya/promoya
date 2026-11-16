import { useEffect, useState } from 'react';
import { api, useAviso, ir, Modal, ChipContacto, pct, hace } from '../ui.jsx';
import { Importar, FormContacto, exportarNombreEmail } from './Contactos.jsx';

const FILTROS = [
  ['todos', 'Todos', 'total'],
  ['singrupo', 'Sin grupo', 'singrupo'],
  ['frios', '❄ Fríos', 'frios'],
  ['inactivos', 'Bajas', 'inactivos'],
];

// Usuarios: la gente que descargó tu música (Hypeddit, etc.). Pueden ser miles: la lista viene por páginas.
export default function Usuarios() {
  const avisar = useAviso();
  const [busca, setBusca] = useState('');
  const [q, setQ] = useState('');
  const [filtro, setFiltro] = useState('todos');
  const [pagina, setPagina] = useState(1);
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null);

  useEffect(() => { const t = setTimeout(() => { setQ(busca); setPagina(1); }, 350); return () => clearTimeout(t); }, [busca]);
  const cargar = () => api(`contactos?lista=usuarios&pagina=${pagina}&q=${encodeURIComponent(q)}&filtro=${filtro}`).then((x) => { setD(x); setError(''); }).catch((e) => setError(e.message));
  useEffect(() => { cargar(); }, [q, filtro, pagina]);

  if (error) return <div className="aviso mal">{error}</div>;
  if (!d) return <div className="cargando">Cargando…</div>;
  const paginas = Math.max(1, Math.ceil(d.total / d.por));
  const c = d.cuentas || {};

  return (
    <>
      <div className="cabecera">
        <div><h1>Usuarios</h1><p>Gente que descargó tu música · {c.total || 0} usuarios · {c.activos || 0} activos</p></div>
        <div className="acciones">
          <button className="btn" onClick={() => exportarNombreEmail(avisar)} title="Contactos y usuarios juntos, en un Excel con nombre y email">⬇ Nombres y emails (todos)</button>
          <button className="btn" onClick={() => setModal('importar')}>Importar</button>
          <button className="btn primario" onClick={() => setModal('nuevo')}>+ Usuario</button>
        </div>
      </div>

      <div className="aviso info">
        <span>Los usuarios van <b>separados de tus contactos</b>: se mandan en grupos de hasta 490 y <b>nunca el mismo día</b> que tus DJs. Si un mail rebota («dirección no encontrada»), ese usuario <b>se borra solo</b>.</span>
      </div>
      {c.singrupo > 0 && filtro !== 'singrupo' && (
        <div className="aviso"><span>{c.singrupo} usuarios activos todavía no están en ningún grupo.</span><a className="btn chico" href="#/grupos?lista=usuarios">Armar grupos</a></div>
      )}

      <div className="filtros">
        <input type="search" placeholder="Buscar por email, nombre, tema, país…" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar" />
        <div className="pestanias">
          {FILTROS.map(([k, t, cuenta]) => (
            <button key={k} className={`pestania ${filtro === k ? 'activa' : ''}`} onClick={() => { setFiltro(k); setPagina(1); }}>{t} ({c[cuenta] || 0})</button>
          ))}
        </div>
      </div>

      {!c.total ? (
        <div className="tarjeta vacio"><b>Cargá a la gente que descargó tu música</b>Subí los archivos de Hypeddit (CSV o Excel) tal cual: reconozco solo los emails y nombres.
          <div style={{ marginTop: 16 }}><button className="btn primario" onClick={() => setModal('importar')}>Importar usuarios</button></div></div>
      ) : (
        <>
          <div className="tabla-envoltura">
            <table>
              <thead><tr><th>Usuario</th><th>Lanzamiento / etiquetas</th><th>Grupos</th><th className="num">Recibió</th><th className="num">Abrió</th><th className="num">Clics</th><th>Última señal</th><th></th></tr></thead>
              <tbody>
                {d.filas.map((u) => (
                  <tr key={u.id} className="clic" onClick={() => ir(`contactos/${u.id}`)}>
                    <td><b>{u.email}</b>{u.nombre && <div className="sub">{u.nombre}{u.pais ? ` · ${u.pais}` : ''}</div>}</td>
                    <td className="sub" style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.etiquetas || '—'}</td>
                    <td className="sub">{u.grupos || '—'}</td>
                    <td className="num">{u.recibidas}</td>
                    <td className="num">{u.abiertas}{u.recibidas ? <span className="sub"> {pct(u.abiertas, u.recibidas)}%</span> : ''}</td>
                    <td className="num">{u.clics}</td>
                    <td className="sub">{u.ultima ? hace(u.ultima) : '—'}</td>
                    <td><ChipContacto c={u} /></td>
                  </tr>
                ))}
                {!d.filas.length && <tr><td colSpan={8} className="vacio">Nadie con ese filtro.</td></tr>}
              </tbody>
            </table>
          </div>
          {paginas > 1 && (
            <div className="filtros" style={{ justifyContent: 'center', marginTop: 12 }}>
              <button className="btn chico" disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>← Anterior</button>
              <span className="sub">Página {pagina} de {paginas} · {d.total} usuarios</span>
              <button className="btn chico" disabled={pagina >= paginas} onClick={() => setPagina(pagina + 1)}>Siguiente →</button>
            </div>
          )}
        </>
      )}

      {modal === 'nuevo' && <Modal titulo="Nuevo usuario" onCerrar={() => setModal(null)}><FormContacto inicial={{ lista: 'usuarios', tipo: 'otro' }} onCancelar={() => setModal(null)} onGuardado={() => { setModal(null); cargar(); }} /></Modal>}
      {modal === 'importar' && <Importar lista="usuarios" onCerrar={() => setModal(null)} onListo={() => { setModal(null); cargar(); }} />}
    </>
  );
}
