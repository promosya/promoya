import { useState } from 'react';
import { useDatos, useAviso, ir, Modal, ChipContacto, hace } from '../ui.jsx';
import { Importar, FormContacto, exportarNombreEmail, bajarPlanillaSellos } from './Contactos.jsx';

// Sellos: a quiénes les mandás tus demos. Alcanza con el nombre y el email.
export default function Sellos() {
  const avisar = useAviso();
  const [lista, recargar, error] = useDatos('contactos?lista=sellos');
  const [modal, setModal] = useState(null);
  const [busca, setBusca] = useState('');
  if (error) return <div className="aviso mal">{error}</div>;
  if (!lista) return <div className="cargando">Cargando…</div>;
  const q = busca.toLowerCase();
  const vis = lista.filter((s) => !q || `${s.nombre} ${s.email} ${s.pais} ${s.notas}`.toLowerCase().includes(q));
  const activos = lista.filter((s) => s.estado === 'activo').length;
  const sinGrupo = lista.filter((s) => s.estado === 'activo' && !s.grupos).length;

  return (
    <>
      <div className="cabecera">
        <div><h1>Sellos</h1><p>A quiénes les mandás tus demos · {lista.length} sellos · {activos} activos</p></div>
        <div className="acciones">
          <button className="btn" onClick={bajarPlanillaSellos}>⬇ Planilla de sellos</button>
          <button className="btn" onClick={() => exportarNombreEmail(avisar)} title="Contactos, usuarios y sellos juntos, en un Excel con nombre y email">⬇ Nombres y emails (todos)</button>
          <button className="btn" onClick={() => setModal('importar')}>Importar</button>
          <button className="btn primario" onClick={() => setModal('nuevo')}>+ Sello</button>
        </div>
      </div>

      {lista.length > 0 && (
        <div className="aviso info">
          <span>Para mandarles demos: armá grupos de sellos en <b>Grupos</b> y creá una campaña de tipo <b>Demos</b> con el link de tu playlist.{sinGrupo ? ` Hay ${sinGrupo} sellos sin grupo.` : ''}</span>
          <a className="btn chico" href="#/campanias/nueva?tipo=demos">Nueva campaña de demos</a>
        </div>
      )}

      {!lista.length ? (
        <div className="tarjeta vacio"><b>Cargá los sellos</b>Alcanza con el nombre del sello y el email donde reciben demos. Podés cargarlos de a uno o todos juntos con la planilla.
          <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className="btn" onClick={bajarPlanillaSellos}>⬇ Descargar planilla</button>
            <button className="btn primario" onClick={() => setModal('importar')}>Importar planilla</button>
            <button className="btn" onClick={() => setModal('nuevo')}>+ Agregar uno</button>
          </div></div>
      ) : (
        <>
          <div className="filtros">
            <input type="search" placeholder="Buscar sello, email, país…" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar" />
          </div>
          <div className="tabla-envoltura">
            <table>
              <thead><tr><th>Sello</th><th>País</th><th>Grupos</th><th className="num">Demos</th><th className="num">Abrió</th><th className="num">Escuchó</th><th className="num">Respondió</th><th>Última señal</th><th></th></tr></thead>
              <tbody>
                {vis.map((s) => (
                  <tr key={s.id} className="clic" onClick={() => ir(`contactos/${s.id}`)}>
                    <td><b>{s.nombre || '—'}</b><div className="sub">{s.email}</div></td>
                    <td className="sub">{s.pais || '—'}</td>
                    <td className="sub">{s.grupos || '—'}</td>
                    <td className="num">{s.recibidas}</td>
                    <td className="num">{s.abiertas}</td>
                    <td className="num">{s.clics}</td>
                    <td className="num">{s.respuestas ? <span className="si">{s.respuestas}</span> : 0}</td>
                    <td className="sub">{s.ultima ? hace(s.ultima) : '—'}</td>
                    <td><ChipContacto c={s} /></td>
                  </tr>
                ))}
                {!vis.length && <tr><td colSpan={9} className="vacio">Ningún sello con esa búsqueda.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {modal === 'nuevo' && (
        <Modal titulo="Nuevo sello" onCerrar={() => setModal(null)}>
          <FormContacto inicial={{ lista: 'sellos', tipo: 'sello' }} simple onCancelar={() => setModal(null)} onGuardado={() => { setModal(null); recargar(); }} />
        </Modal>
      )}
      {modal === 'importar' && <Importar lista="sellos" onCerrar={() => setModal(null)} onListo={() => { setModal(null); recargar(); }} />}
    </>
  );
}
