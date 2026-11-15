import { useEffect, useState } from 'react';
import { api, useAviso, Modal, diaLindo } from '../ui.jsx';

const sumarDias = (dia, n) => { const d = new Date(dia + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// Reenviar una campaña a grupos nuevos: se programan solos, uno por día.
export default function AgregarGrupos({ campania, onCerrar, onListo }) {
  const avisar = useAviso();
  const [datos, setDatos] = useState(null);
  const [elegidos, setElegidos] = useState([]);
  const [inicio, setInicio] = useState('');
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    api(`campanias/${campania.id}/candidatos`).then((d) => { setDatos(d); setInicio(d.proximo); }).catch((e) => avisar(e.message, true));
  }, [campania.id]);

  const alternar = (id) => setElegidos((x) => (x.includes(id) ? x.filter((g) => g !== id) : [...x, id]));
  const mover = (id, d) => setElegidos((x) => {
    const g = [...x]; const i = g.indexOf(id); const j = i + d;
    if (j < 0 || j >= g.length) return x;
    [g[i], g[j]] = [g[j], g[i]];
    return g;
  });

  const porId = new Map((datos?.grupos || []).map((g) => [g.id, g]));
  const total = elegidos.reduce((a, id) => a + (porId.get(id)?.nuevos || 0), 0);
  const ordenados = datos ? [...elegidos.map((id) => porId.get(id)).filter(Boolean), ...datos.grupos.filter((g) => !elegidos.includes(g.id))] : [];

  const guardar = async () => {
    setGuardando(true);
    try {
      const r = await api(`campanias/${campania.id}/agregar-grupos`, { metodo: 'POST', datos: { grupos: elegidos, inicio } });
      avisar(`Listo: ${r.total} mails programados desde el ${diaLindo(r.desde)}${r.pausada ? '. La campaña está pausada: reanudala para que salgan' : ''}`);
      onListo();
    } catch (e) { avisar(e.message, true); }
    finally { setGuardando(false); }
  };

  return (
    <Modal titulo="Reenviar a más grupos" onCerrar={onCerrar} pie={<>
      <span className="sub" style={{ marginRight: 'auto', alignSelf: 'center' }}>{elegidos.length ? `${elegidos.length} grupos · ${total} mails` : ''}</span>
      <button className="btn fantasma" onClick={onCerrar}>Cancelar</button>
      <button className="btn primario" onClick={guardar} disabled={guardando || !total}>{guardando ? 'Programando…' : 'Programar envíos'}</button>
    </>}>
      <p className="sub" style={{ marginTop: 0 }}>
        Elegí los grupos a los que querés mandarles <b>{campania.nombre}</b>. Sale uno por día, en el orden que elijas, y se manda solo, respetando el tope diario.
        Si un contacto ya recibió esta campaña, no se le vuelve a mandar.
      </p>
      {!datos ? <div className="cargando" style={{ padding: 20 }}>Cargando…</div> : !datos.grupos.length ? (
        <div className="aviso">No hay grupos. Armalos en <a href="#/grupos">Grupos</a>.</div>
      ) : (
        <>
          <div className="campo" style={{ maxWidth: 220 }}>
            <label htmlFor="ag-ini">Empezar el</label>
            <input id="ag-ini" type="date" value={inicio} min={datos.hoy} onChange={(e) => setInicio(e.target.value)} />
          </div>
          <div className="grupo-sel">
            {ordenados.map((g) => {
              const i = elegidos.indexOf(g.id);
              const elegido = i >= 0;
              const sinNuevos = !g.nuevos;
              return (
                <div key={g.id} className={`grupo-item ${elegido ? 'elegido' : ''}`} style={sinNuevos && !elegido ? { opacity: 0.5 } : undefined}>
                  <input type="checkbox" checked={elegido} disabled={sinNuevos && !elegido} onChange={() => alternar(g.id)} aria-label={`Elegir ${g.nombre}`} style={{ accentColor: 'var(--acento)' }} />
                  {elegido && <span className="orden">{i + 1}</span>}
                  <div style={{ minWidth: 0 }}>
                    <b>{g.nombre}</b>{' '}
                    <span className="sub">{sinNuevos ? (g.activos ? 'ya la recibieron todos' : 'sin contactos activos') : `${g.nuevos} sin recibirla${g.en_campania ? ' (nuevos en el grupo)' : ''}`}</span>
                    {elegido && inicio && <div className="sub">{diaLindo(sumarDias(inicio, i))}</div>}
                  </div>
                  {elegido && (
                    <div className="mover">
                      <button className="btn chico fantasma" onClick={() => mover(g.id, -1)} aria-label="Subir">↑</button>
                      <button className="btn chico fantasma" onClick={() => mover(g.id, 1)} aria-label="Bajar">↓</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <p className="sub" style={{ marginBottom: 0 }}>¿Contactos nuevos? Cargalos en <a href="#/contactos">Contactos</a>, armá un grupo con ellos en <a href="#/grupos">Grupos</a> y volvé acá.</p>
        </>
      )}
    </Modal>
  );
}
