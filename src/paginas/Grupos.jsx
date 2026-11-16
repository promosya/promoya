import { useEffect, useState } from 'react';
import { api, useDatos, useAviso, Modal, TIPOS, ChipContacto } from '../ui.jsx';

const MAX_GRUPO = 490; // Gmail personal no deja mandar más de 500 por día

function Auto({ onCerrar, onListo, total, sinGrupo, lista }) {
  const avisar = useAviso();
  const usuarios = lista === 'usuarios';
  const [f, setF] = useState({ tamanio: MAX_GRUPO, tipo: '', etiqueta: '', prefijo: usuarios ? 'Usuarios' : 'Grupo', excluirFrios: !usuarios, mezclar: true, soloSinGrupo: sinGrupo > 0 && sinGrupo < total });
  const [creando, setCreando] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const tam = Math.min(MAX_GRUPO, Math.max(1, Number(f.tamanio) || 1));
  const base = f.soloSinGrupo ? sinGrupo : total;
  const crear = async () => {
    setCreando(true);
    try { const r = await api('grupos/auto', { metodo: 'POST', datos: { ...f, lista, tamanio: tam } }); avisar(`${r.creados.length} grupos creados`); onListo(); }
    catch (e) { avisar(e.message, true); }
    finally { setCreando(false); }
  };
  return (
    <Modal titulo={usuarios ? 'Armar grupos de usuarios' : 'Armar grupos de contactos'} onCerrar={onCerrar} pie={<><button className="btn fantasma" onClick={onCerrar}>Cancelar</button><button className="btn primario" onClick={crear} disabled={creando}>{creando ? 'Creando…' : 'Crear grupos'}</button></>}>
      <div className="fila">
        <div className="campo"><label htmlFor="at">Personas por grupo (máx. {MAX_GRUPO})</label><input id="at" type="number" min={1} max={MAX_GRUPO} value={f.tamanio} onChange={set('tamanio')} />
          <span className="ayuda">Con {base} {usuarios ? 'usuarios' : 'contactos'} salen {Math.ceil(base / tam)} grupos (uno por día). Gmail personal corta en 500 por día.</span></div>
        <div className="campo"><label htmlFor="ap">Nombre</label><input id="ap" type="text" value={f.prefijo} onChange={set('prefijo')} /><span className="ayuda">Quedan «{f.prefijo} 1», «{f.prefijo} 2»… (sigue la numeración si ya hay)</span></div>
      </div>
      <div className="fila">
        {!usuarios && <div className="campo"><label htmlFor="ati">Solo de este tipo</label>
          <select id="ati" value={f.tipo} onChange={set('tipo')}><option value="">Todos</option>{Object.entries(TIPOS).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></div>}
        <div className="campo"><label htmlFor="ae">{usuarios ? 'Solo de este lanzamiento / etiqueta' : 'Solo con la etiqueta'}</label><input id="ae" type="text" value={f.etiqueta} onChange={set('etiqueta')} placeholder="(opcional)" /></div>
      </div>
      {sinGrupo > 0 && sinGrupo < total && <label className="check" style={{ marginBottom: 8 }}><input type="checkbox" checked={f.soloSinGrupo} onChange={set('soloSinGrupo')} /> Solo los que todavía no están en ningún grupo ({sinGrupo})</label>}
      <label className="check" style={{ marginBottom: 8 }}><input type="checkbox" checked={f.excluirFrios} onChange={set('excluirFrios')} /> Dejar afuera a los fríos (no abren nunca)</label>
      <label className="check"><input type="checkbox" checked={f.mezclar} onChange={set('mezclar')} /> Mezclarlos al azar</label>
    </Modal>
  );
}

function Editar({ grupo, contactos, lista, onCerrar, onListo }) {
  const avisar = useAviso();
  const usuarios = lista === 'usuarios';
  const [nombre, setNombre] = useState(grupo?.nombre || '');
  const [sel, setSel] = useState(new Set(grupo?.contactos || []));
  const [busca, setBusca] = useState('');
  const q = busca.toLowerCase();
  const vis = (contactos || []).filter((c) => !q || `${c.nombre} ${c.email} ${c.etiquetas}`.toLowerCase().includes(q));
  const alternar = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const guardar = async () => {
    try {
      if (grupo?.id) await api(`grupos/${grupo.id}`, { metodo: 'PUT', datos: usuarios ? { nombre } : { nombre, contactos: [...sel] } });
      else await api('grupos', { metodo: 'POST', datos: { nombre, lista, contactos: [...sel] } });
      avisar('Grupo guardado'); onListo();
    } catch (e) { avisar(e.message, true); }
  };
  return (
    <Modal titulo={grupo?.id ? 'Editar grupo' : 'Nuevo grupo'} onCerrar={onCerrar} pie={<><span className="sub" style={{ marginRight: 'auto', alignSelf: 'center' }}>{usuarios ? `${grupo?.contactos?.length || 0} usuarios` : `${sel.size} elegidos`}</span><button className="btn fantasma" onClick={onCerrar}>Cancelar</button><button className="btn primario" onClick={guardar}>Guardar</button></>}>
      <div className="campo"><label htmlFor="gn">Nombre</label><input id="gn" type="text" value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus /></div>
      {usuarios ? (
        <p className="sub" style={{ margin: 0 }}>Los grupos de usuarios se arman automáticamente. Para cambiar quiénes están, borrá el grupo y volvé a armarlo.</p>
      ) : (
        <>
          <div className="filtros">
            <input type="search" placeholder="Buscar…" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar" style={{ maxWidth: 'none', flex: 1 }} />
            <button className="btn chico" onClick={() => setSel((s) => new Set([...s, ...vis.map((c) => c.id)]))}>Todos</button>
            <button className="btn chico" onClick={() => setSel((s) => { const n = new Set(s); vis.forEach((c) => n.delete(c.id)); return n; })}>Ninguno</button>
          </div>
          <div className="grupo-sel" style={{ maxHeight: 340 }}>
            {vis.map((c) => (
              <label key={c.id} className={`grupo-item ${sel.has(c.id) ? 'elegido' : ''}`} style={{ cursor: 'pointer' }}>
                <input type="checkbox" checked={sel.has(c.id)} onChange={() => alternar(c.id)} style={{ accentColor: 'var(--acento)' }} />
                <div style={{ minWidth: 0 }}><b>{c.nombre || c.email}</b> <span className="sub">{c.email}</span></div>
                <span style={{ marginLeft: 'auto' }}><ChipContacto c={c} /></span>
              </label>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}

export default function Grupos() {
  const inicial = /lista=usuarios/.test(location.hash) ? 'usuarios' : 'contactos';
  const [lista, setLista] = useState(inicial);
  const usuarios = lista === 'usuarios';
  const [grupos, recargar, error] = useDatos('grupos');
  const [contactos, recargarC] = useDatos('contactos?lista=contactos');
  const [cuentasU, setCuentasU] = useState(null);
  const avisar = useAviso();
  const [modal, setModal] = useState(null);
  const cargarU = () => api('contactos?lista=usuarios&pagina=1&por=20').then((d) => setCuentasU(d.cuentas)).catch(() => {});
  useEffect(() => { cargarU(); }, []);
  if (error) return <div className="aviso mal">{error}</div>;
  if (!grupos || !contactos) return <div className="cargando">Cargando…</div>;

  const activosC = contactos.filter((c) => c.estado === 'activo');
  const total = usuarios ? (cuentasU?.activos || 0) : activosC.length;
  const sinGrupo = usuarios ? (cuentasU?.singrupo || 0) : activosC.filter((c) => !c.grupos).length;
  const deLista = grupos.filter((g) => (g.lista || 'contactos') === lista);
  const quien = usuarios ? 'usuarios' : 'contactos';

  const abrir = async (g) => { try { setModal({ tipo: 'editar', grupo: await api(`grupos/${g.id}`) }); } catch (e) { avisar(e.message, true); } };
  const borrar = async (g) => {
    if (!confirm(`¿Borrar el grupo "${g.nombre}"? Los ${quien} no se borran.`)) return;
    try { await api(`grupos/${g.id}`, { metodo: 'DELETE' }); avisar('Grupo borrado'); recargar(); recargarC(); cargarU(); }
    catch (e) { avisar(e.message, true); }
  };
  const borrarTodos = async () => {
    if (!confirm(`¿Borrar los ${deLista.length} grupos de ${quien}? Los ${quien} no se borran.`)) return;
    for (const g of deLista) { try { await api(`grupos/${g.id}`, { metodo: 'DELETE' }); } catch (e) { avisar(e.message, true); } }
    recargar(); recargarC(); cargarU();
  };
  const listo = () => { setModal(null); recargar(); recargarC(); cargarU(); };

  return (
    <>
      <div className="cabecera">
        <div><h1>Grupos</h1><p>Cada día de una campaña sale un grupo (hasta {MAX_GRUPO} personas). Contactos y usuarios salen en días distintos.</p></div>
        <div className="acciones">
          {deLista.length > 1 && <button className="btn fantasma peligro" onClick={borrarTodos}>Borrar todos</button>}
          {!usuarios && <button className="btn" onClick={() => setModal({ tipo: 'editar', grupo: null })}>+ Grupo a mano</button>}
          <button className="btn primario" onClick={() => setModal({ tipo: 'auto' })} disabled={!total}>Armar automáticamente</button>
        </div>
      </div>
      <div className="pestanias" style={{ marginBottom: 14 }}>
        <button className={`pestania ${!usuarios ? 'activa' : ''}`} onClick={() => setLista('contactos')}>Contactos (DJs, sellos…)</button>
        <button className={`pestania ${usuarios ? 'activa' : ''}`} onClick={() => setLista('usuarios')}>Usuarios (descargas)</button>
      </div>
      {sinGrupo > 0 && deLista.length > 0 && <div className="aviso info"><span>{sinGrupo} {quien} activos no están en ningún grupo.</span><button className="btn chico" onClick={() => setModal({ tipo: 'auto' })}>Agruparlos</button></div>}
      {!deLista.length ? (
        <div className="tarjeta vacio"><b>No hay grupos de {quien}</b>{total ? `Tenés ${total} ${quien} activos. Dividilos en grupos de hasta ${MAX_GRUPO}.` : `Primero cargá tus ${quien}.`}
          <div style={{ marginTop: 16 }}>{total ? <button className="btn primario" onClick={() => setModal({ tipo: 'auto' })}>Armar automáticamente</button> : <a className="btn primario" href={`#/${quien}`}>Ir a {usuarios ? 'Usuarios' : 'Contactos'}</a>}</div></div>
      ) : (
        <div className="tabla-envoltura">
          <table>
            <thead><tr><th>Grupo</th><th className="num">{usuarios ? 'Usuarios' : 'Contactos'}</th><th className="num">Activos</th><th></th></tr></thead>
            <tbody>
              {deLista.map((g) => (
                <tr key={g.id} className="clic" onClick={() => abrir(g)}>
                  <td><b>{g.nombre}</b></td><td className="num">{g.cantidad}</td><td className="num">{g.activos || 0}</td>
                  <td style={{ textAlign: 'right' }}><button className="btn chico fantasma peligro" onClick={(e) => { e.stopPropagation(); borrar(g); }}>Borrar</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {modal?.tipo === 'auto' && <Auto lista={lista} total={total} sinGrupo={sinGrupo} onCerrar={() => setModal(null)} onListo={listo} />}
      {modal?.tipo === 'editar' && <Editar lista={lista} grupo={modal.grupo} contactos={usuarios ? null : contactos} onCerrar={() => setModal(null)} onListo={listo} />}
    </>
  );
}
