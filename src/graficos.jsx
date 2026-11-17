import { useEffect, useRef, useState } from 'react';
import { pct, diaLindo } from './ui.jsx';

// Colores de cada lista (los mismos en todos los gráficos)
export const LISTAS_INFO = {
  contactos: { nombre: 'DJs y contactos', corto: 'DJs', color: 'var(--s-djs)' },
  usuarios: { nombre: 'Usuarios', corto: 'Usuarios', color: 'var(--s-usuarios)' },
  sellos: { nombre: 'Sellos', corto: 'Sellos', color: 'var(--s-sellos)' },
};

// Ancho real del contenedor (para dibujar el SVG con texto nítido)
function useAncho() {
  const ref = useRef(null);
  const [ancho, setAncho] = useState(600);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setAncho(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, ancho];
}

// Cartelito que sigue al mouse
export function useTip() {
  const [tip, setTip] = useState(null);
  // al bajar con la rueda el mouse "sale" sin avisar: se esconde
  useEffect(() => {
    if (!tip) return;
    const f = () => setTip(null);
    window.addEventListener('scroll', f, { passive: true, once: true });
    return () => window.removeEventListener('scroll', f);
  }, [tip]);
  const mostrar = (e, contenido) => {
    const x = Math.min(e.clientX + 16, window.innerWidth - 300);
    const y = e.clientY + 18 > window.innerHeight - 140 ? e.clientY - 120 : e.clientY + 18;
    setTip({ x, y, contenido });
  };
  const el = tip ? <div className="tip" style={{ left: tip.x, top: tip.y }}>{tip.contenido}</div> : null;
  return [el, mostrar, () => setTip(null)];
}

// Tope del eje: 4 rayas con números redondos
function techo(v) {
  const paso = v / 4;
  if (paso <= 1) return 4;
  const p = 10 ** Math.floor(Math.log10(paso));
  for (const m of [1, 2, 5, 10]) if (m * p >= paso) return m * p * 4;
  return 40 * p;
}

// ---------- Actividad de 30 días: barras (enviados) + líneas (aperturas y clics) ----------
const SERIES_ACT = [
  { k: 'enviados', t: 'Enviados', c: 'rgba(255,255,255,.18)', tipo: 'barra' },
  { k: 'aperturas', t: 'Aperturas', c: 'var(--acento)', tipo: 'linea' },
  { k: 'clics', t: 'Clics al link', c: '#f3f0f8', tipo: 'linea' },
];
export function Actividad({ datos }) {
  const [ref, W] = useAncho();
  const [tipEl, mostrar, ocultar] = useTip();
  const [foco, setFoco] = useState(null);
  const H = 220, izq = 34, der = 8, arr = 10, abj = 24;
  const n = datos.length;
  const max = techo(Math.max(1, ...datos.flatMap((d) => [d.enviados, d.aperturas, d.clics])));
  const ancho = (W - izq - der) / n;
  const x = (i) => izq + ancho * i + ancho / 2;
  const y = (v) => arr + (H - arr - abj) * (1 - v / max);
  const ticks = [0, max / 4, max / 2, (max * 3) / 4, max];
  const linea = (k) => datos.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[k]).toFixed(1)}`).join('');
  const area = `${linea('aperturas')}L${x(n - 1)},${y(0)}L${x(0)},${y(0)}Z`;
  const bw = Math.max(2, ancho - 3);
  const mover = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.max(0, Math.min(n - 1, Math.floor((e.clientX - r.left - izq) / ancho)));
    setFoco(i);
    const d = datos[i];
    mostrar(e, <>
      <div className="tit">{diaLindo(d.dia)}</div>
      {SERIES_ACT.map((s) => <div className="f" key={s.k}><span><i style={{ background: s.c }} />{s.t}</span><b>{d[s.k]}</b></div>)}
      {d.respuestas > 0 && <div className="f"><span>Respuestas</span><b>{d.respuestas}</b></div>}
    </>);
  };
  const vacio = !datos.some((d) => d.enviados || d.aperturas || d.clics);
  return (
    <div className="grafico" ref={ref}>
      <div className="leyenda" style={{ marginBottom: 10 }}>
        {SERIES_ACT.map((s) => <span key={s.k}><i className={s.tipo === 'linea' ? 'linea' : ''} style={{ background: s.c }} />{s.t}</span>)}
      </div>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} onMouseMove={mover} onMouseLeave={() => { setFoco(null); ocultar(); }} role="img" aria-label="Mails enviados, aperturas y clics de los últimos 30 días">
        <defs>
          <linearGradient id="g-aper" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ff2e4a" stopOpacity=".28" /><stop offset="1" stopColor="#ff2e4a" stopOpacity="0" /></linearGradient>
        </defs>
        {ticks.map((t) => <g key={t}>
          <line className={t ? 'grilla-linea' : 'base'} x1={izq} x2={W - der} y1={y(t)} y2={y(t)} />
          <text className="eje" x={izq - 8} y={y(t) + 3.5} textAnchor="end">{Math.round(t)}</text>
        </g>)}
        {datos.map((d, i) => d.enviados > 0 && (
          <rect key={d.dia} x={x(i) - bw / 2} y={y(d.enviados)} width={bw} height={Math.max(1, y(0) - y(d.enviados))} rx={Math.min(3, bw / 2)} fill={foco === i ? 'rgba(255,255,255,.32)' : 'rgba(255,255,255,.16)'} />
        ))}
        {!vacio && <path d={area} fill="url(#g-aper)" />}
        {!vacio && <path d={linea('clics')} fill="none" stroke="#f3f0f8" strokeWidth="2" strokeLinejoin="round" strokeDasharray="4 3" />}
        {!vacio && <path d={linea('aperturas')} fill="none" stroke="var(--acento)" strokeWidth="2" strokeLinejoin="round" style={{ filter: 'drop-shadow(0 0 6px rgba(255,46,74,.6))' }} />}
        {foco != null && <>
          <line x1={x(foco)} x2={x(foco)} y1={arr} y2={y(0)} stroke="rgba(255,255,255,.35)" strokeDasharray="2 3" />
          <circle cx={x(foco)} cy={y(datos[foco].aperturas)} r="4.5" fill="var(--acento)" stroke="#07060a" strokeWidth="2" />
          <circle cx={x(foco)} cy={y(datos[foco].clics)} r="4" fill="#f3f0f8" stroke="#07060a" strokeWidth="2" />
        </>}
        {datos.map((d, i) => (i % (W < 520 ? 7 : 5) === 0 || i === n - 1) && (
          <text key={d.dia} className="eje" x={x(i)} y={H - 6} textAnchor="middle">{i === n - 1 ? 'hoy' : diaLindo(d.dia).replace(/^\S+ /, '')}</text>
        ))}
        {vacio && <text className="eje" x={W / 2} y={H / 2} textAnchor="middle" style={{ fontSize: 13 }}>Cuando salgan tus primeros mails vas a ver la actividad acá</text>}
      </svg>
      {tipEl}
    </div>
  );
}

// ---------- Tarjeta de cada lista ----------
export function TarjetaLista({ lista, s, estados }) {
  const info = LISTAS_INFO[lista];
  const rec = s?.rec || 0;
  const tasas = [
    ['Abrieron', s?.ab || 0],
    ['Tocaron el link', s?.cl || 0],
    ['Escucharon', s?.es || 0],
    ['Respondieron', s?.re || 0],
  ];
  const e = estados || {};
  const total = Object.values(e).reduce((a, b) => a + b, 0);
  return (
    <div className="tarjeta lista-card" style={{ '--c': info.color }}>
      <span className="franja" />
      <h2>{info.nombre}</h2>
      <div className="grande">{(e.activo || 0).toLocaleString('es-AR')}<small>activos de {total.toLocaleString('es-AR')}</small></div>
      <div className="tasas">
        {tasas.map(([t, v]) => (
          <div className="tasa" key={t} title={`${v} de ${rec}`}>
            <span>{t}</span>
            <div className="pista"><i style={{ width: `${rec ? Math.max(v ? 2 : 0, (v / rec) * 100) : 0}%` }} /></div>
            <b>{rec ? `${pct(v, rec)}%` : '—'}</b>
          </div>
        ))}
      </div>
      <div className="pie-lista">
        <span><b>{rec.toLocaleString('es-AR')}</b> mails recibidos</span>
        {e.baja > 0 && <span><b>{e.baja}</b> bajas</span>}
        {e.rebotado > 0 && <span><b>{e.rebotado}</b> rebotados</span>}
        {e.pausado > 0 && <span><b>{e.pausado}</b> pausados</span>}
      </div>
    </div>
  );
}

// ---------- Mapa de calor: cuándo abren ----------
const DIAS_SEM = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
const NUM_SEM = [1, 2, 3, 4, 5, 6, 0];
export function MapaCalor({ horas }) {
  const [tipEl, mostrar, ocultar] = useTip();
  const m = {};
  for (const h of horas) m[`${h.s}-${h.h}`] = h.n;
  const max = Math.max(1, ...horas.map((h) => h.n));
  const total = horas.reduce((a, h) => a + h.n, 0);
  // mejor franja: la hora con más aperturas sumando todos los días
  const porHora = Array.from({ length: 24 }, (_, h) => horas.filter((x) => x.h === h).reduce((a, x) => a + x.n, 0));
  const mejor = porHora.indexOf(Math.max(...porHora));
  const color = (n) => (n ? `color-mix(in srgb, #ff2e4a ${Math.round(18 + (n / max) * 82)}%, #1a1016)` : undefined);
  return (
    <div>
      {total > 0 && <p className="sub" style={{ marginTop: -6, marginBottom: 14 }}>La hora en que más abren: <b style={{ color: 'var(--texto)' }}>{String(mejor).padStart(2, '0')}:00 a {String((mejor + 1) % 24).padStart(2, '0')}:00</b>. PromoYa ya usa esto para mandarle a cada uno en su mejor horario.</p>}
      <div className="calor" onMouseLeave={ocultar}>
        <span />
        {Array.from({ length: 24 }, (_, h) => <span className="hora" key={h}>{h % 3 === 0 ? h : ''}</span>)}
        {NUM_SEM.map((s, fi) => [
          <span className="dia-c" key={`d${s}`}>{DIAS_SEM[fi]}</span>,
          ...Array.from({ length: 24 }, (_, h) => {
            const n = m[`${s}-${h}`] || 0;
            return <span key={`${s}-${h}`} className="celda" style={{ background: color(n) }}
              onMouseMove={(e) => mostrar(e, <><div className="tit">{DIAS_SEM[fi]} · {String(h).padStart(2, '0')}:00</div><div className="f"><span>Aperturas y clics</span><b>{n}</b></div></>)} />;
          }),
        ])}
      </div>
      <div className="escala">
        <span>Menos</span>
        {[0, .25, .5, .75, 1].map((p) => <i key={p} style={{ background: p ? `color-mix(in srgb, #ff2e4a ${Math.round(18 + p * 82)}%, #1a1016)` : 'rgba(255,255,255,.04)' }} />)}
        <span>Más</span>
        <span style={{ marginLeft: 'auto' }}>Últimos 90 días · hora de Argentina</span>
      </div>
      {tipEl}
    </div>
  );
}

// ---------- Campañas comparadas ----------
export function RankingCampanias({ campanias }) {
  if (!campanias.length) return <div className="vacio" style={{ padding: 24 }}>Todavía no salió ninguna campaña.</div>;
  return (
    <div className="ranking">
      {[...campanias].reverse().map((c) => (
        <a className="rank" key={c.id} href={`#/campanias/${c.id}`} style={{ textDecoration: 'none' }}>
          <span className="nombre"><span>{c.nombre}</span><span className={`chip ${c.tipo === 'demos' ? 'azul' : ''}`}>{c.tipo === 'demos' ? 'Demos' : 'Promo'}</span></span>
          <span className="valor">{pct(c.ab, c.rec)}%</span>
          <span className="pista"><i style={{ width: `${pct(c.ab, c.rec)}%` }} /></span>
          <span className="detalle">{c.rec} recibieron · {c.cl} tocaron el link · {c.es} escucharon · {c.re} respondieron</span>
        </a>
      ))}
    </div>
  );
}

// ---------- Los más activos ----------
export function Fans({ lista, vacio }) {
  if (!lista.length) return <div className="vacio" style={{ padding: 20 }}>{vacio}</div>;
  return (
    <div className="fans">
      {lista.map((c) => {
        const info = LISTAS_INFO[c.lista] || LISTAS_INFO.contactos;
        const nombre = c.nombre || c.email;
        return (
          <a className="fan" key={c.id} href={`#/contactos/${c.id}`} style={{ '--c': info.color }}>
            <span className="avatar">{nombre.trim().charAt(0).toUpperCase()}</span>
            <span className="quien"><b>{nombre}</b><span>{info.corto} · abrió {c.ab} {c.ab === 1 ? 'vez' : 'veces'}</span></span>
            <span className="marcas">
              {c.re > 0 && <span className="chip ok" title="Te respondió">↩ {c.re}</span>}
              {c.es > 0 && <span className="chip ok" title="Escuchó">🎧 {c.es}</span>}
              {c.cl > 0 && <span className="chip acento" title="Tocó el link">▶ {c.cl}</span>}
            </span>
          </a>
        );
      })}
    </div>
  );
}
