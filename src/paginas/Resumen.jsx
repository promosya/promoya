import { useDatos, Kpi, Embudo, Evento, diaLindo, pct, BotonEnviarAhora, EstadoMotor } from '../ui.jsx';
import { Actividad, TarjetaLista, MapaCalor, RankingCampanias, Fans, LISTAS_INFO } from '../graficos.jsx';

export default function Resumen() {
  const [d, recargar, error] = useDatos('resumen');
  if (error) return <div className="aviso mal">{error}</div>;
  if (!d) return <div className="cargando">Cargando…</div>;

  const an = d.analitica || { porLista: [], estados: [], diario: [], horas: [], campanias: [], activos: [], sellosActivos: [] };
  const maxDia = Math.max(1, ...d.proyeccion.map((x) => Math.max(x.tope, x.salen + x.ya)));
  const pendientesProx = d.proyeccion.reduce((a, x) => a + x.salen, 0);
  const porLista = Object.fromEntries(an.porLista.map((x) => [x.lista, x]));
  const estados = {};
  for (const e of an.estados) (estados[e.lista] ||= {})[e.estado] = e.n;
  const ult7 = an.diario.slice(-7).reduce((a, x) => a + x.enviados, 0);
  const prev7 = an.diario.slice(-14, -7).reduce((a, x) => a + x.enviados, 0);

  return (
    <>
      <div className="cabecera">
        <div><h1>Resumen</h1><p>Cómo vienen tus promos y tus demos, lista por lista.</p></div>
        <div className="acciones">
          {d.pendientes > 0 && <BotonEnviarAhora onListo={recargar} texto={d.modoPrueba ? 'Simular una tanda' : 'Enviar ahora'} />}
          <a className="btn primario" href="#/campanias/nueva">+ Nueva campaña</a>
        </div>
      </div>

      {d.modoPrueba && <div className="aviso info"><span><b>Modo prueba:</b> los envíos se simulan, no sale ningún mail real.</span></div>}
      {!d.modoPrueba && !d.gmail.conectado && (
        <div className="aviso"><span><b>Gmail sin conectar.</b> Las campañas quedan en espera hasta que conectes el Gmail del proyecto.</span><a className="btn chico" href="#/ajustes">Conectar</a></div>
      )}

      <EstadoMotor motor={d.motor} />

      <div className="kpis">
        <Kpi titulo="Hoy" valor={`${d.cupo.enviados}/${d.cupo.tope}`} detalle={`quedan ${d.cupo.restante} mails`} acento />
        <Kpi titulo="Últimos 7 días" valor={ult7.toLocaleString('es-AR')} detalle={prev7 ? `${ult7 >= prev7 ? '▲' : '▼'} ${Math.abs(pct(ult7 - prev7, prev7))}% vs. semana anterior` : 'mails enviados'} />
        <Kpi titulo="Enviados en total" valor={d.recibidas.toLocaleString('es-AR')} detalle={`${d.pendientes} en cola · ${d.activas} campañas`} />
        <Kpi titulo="Abrieron" valor={`${pct(d.abiertas, d.recibidas)}%`} detalle={`${d.abiertas} de ${d.recibidas}`} />
        <Kpi titulo="Escucharon" valor={d.escuchadas} detalle={`${d.clics} tocaron el link`} />
        <Kpi titulo="Respuestas" valor={d.respuestas} detalle={`${pct(d.respuestas, d.recibidas)}% te escribió`} />
      </div>

      <div className="grilla lado estirar">
        <div className="tarjeta">
          <div className="tarjeta-cab"><div><h2>Actividad · 30 días</h2><div className="sub">Mails que salieron cada día y cuántos los abrieron o tocaron el link.</div></div></div>
          <Actividad datos={an.diario} />
        </div>
        <div className="tarjeta">
          <h2>Embudo · todas las campañas</h2>
          <Embudo s={d} />
          <p className="sub" style={{ marginBottom: 0, marginTop: 16 }}>{d.frios > 0 ? `${d.frios} contactos están fríos (no abren hace varias promos).` : 'Ningún contacto frío por ahora.'}</p>
        </div>
      </div>

      <div className="listas" style={{ marginTop: 18 }}>
        {['contactos', 'usuarios', 'sellos'].map((l) => <TarjetaLista key={l} lista={l} s={porLista[l]} estados={estados[l]} />)}
      </div>

      <div className="grilla g2" style={{ marginTop: 18 }}>
        <div className="tarjeta">
          <h2>Cuándo abren tus mails</h2>
          <MapaCalor horas={an.horas} />
        </div>
        <div className="tarjeta">
          <div className="tarjeta-cab"><div><h2>Tus últimas campañas</h2><div className="sub">Porcentaje de gente que abrió cada una.</div></div><a className="btn chico" href="#/campanias">Ver todas</a></div>
          <RankingCampanias campanias={an.campanias} />
        </div>
      </div>

      <div className="grilla g2" style={{ marginTop: 18 }}>
        <div className="tarjeta">
          <div className="tarjeta-cab"><div><h2>Los más activos</h2><div className="sub">DJs y usuarios que más abren, escuchan y te responden.</div></div></div>
          <Fans lista={an.activos} vacio="Cuando empiecen a abrir tus mails vas a ver acá a los más interesados." />
        </div>
        <div className="tarjeta">
          <div className="tarjeta-cab"><div><h2>Sellos interesados</h2><div className="sub">Los que abrieron, escucharon o respondieron tus demos.</div></div><a className="btn chico" href="#/sellos">Sellos</a></div>
          <Fans lista={an.sellosActivos} vacio="Todavía ningún sello abrió tus demos." />
        </div>
      </div>

      <div className="grilla lado" style={{ marginTop: 18 }}>
        <div className="tarjeta">
          <h2>Próximos 14 días</h2>
          {pendientesProx === 0 && !d.proyeccion[0].ya
            ? <div className="vacio" style={{ padding: 24 }}>No hay envíos programados.</div>
            : (
              <div className="dias">
                {d.proyeccion.map((x, i) => (
                  <div className="dia" key={x.dia} title={Object.entries(x.porCampania).map(([k, v]) => `${k}: ${v}`).join('\n')}>
                    <span className={i === 0 ? '' : 'sub'}>{i === 0 ? 'Hoy' : diaLindo(x.dia)}{x.lista && <span className={`chip ${{ usuarios: 'azul', sellos: 'aviso' }[x.lista] || 'acento'}`} style={{ marginLeft: 6, padding: '0 6px', fontSize: 9 }}>{LISTAS_INFO[x.lista]?.corto || 'DJs'}</span>}</span>
                    <div className="pista">
                      <i className="ya" style={{ width: `${((x.ya + x.salen) / maxDia) * 100}%` }} />
                      <i style={{ left: `${(x.ya / maxDia) * 100}%`, width: `${(x.salen / maxDia) * 100}%`, background: LISTAS_INFO[x.lista]?.color }} />
                    </div>
                    <span className="num">{x.ya + x.salen}<span className="sub">/{x.tope}</span></span>
                  </div>
                ))}
              </div>
            )}
          {d.proyeccion.some((x) => x.atrasados) && <p className="sub" style={{ marginBottom: 0 }}>Algunos días superan el tope: lo que no entra pasa al día siguiente.</p>}
          <p className="sub" style={{ marginBottom: 0 }}>El tope sube solo: arranca con menos mails por día y crece por semana para cuidar tu Gmail.</p>
        </div>
        <div className="tarjeta">
          <h2>Actividad reciente</h2>
          {d.eventos.length ? <div className="feed" style={{ maxHeight: 520, overflow: 'auto' }}>{d.eventos.map((ev) => <Evento key={ev.id} ev={ev} />)}</div>
            : <div className="vacio" style={{ padding: 24 }}>Acá vas a ver quién abre, escucha y responde.</div>}
        </div>
      </div>
    </>
  );
}
