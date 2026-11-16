// Punto de entrada del Worker de Cloudflare: panel (archivos de dist/), API, seguimiento y el cron.
import { onRequest as api } from './api.js';
import { apertura, clic, baja } from './lib/seguimiento.js';
import { leerConfig, contarConsultas } from './lib/db.js';
import { pasada } from './lib/motor.js';
import { privacidad, condiciones } from './lib/legales.js';

const CADA = 10 * 60e3;

// En la PC (CONTAR_CONSULTAS=1) cuenta las consultas a la base de cada pedido: el plan gratis permite 50.
const conContador = (env, etiqueta) => (env.CONTAR_CONSULTAS === '1' ? { ...env, DB: contarConsultas(env.DB, etiqueta) } : env);
const informar = (env) => env.DB.__informar?.();

export default {
  async fetch(request, entorno, ctx) {
    const { pathname, origin } = new URL(request.url);
    const env = conContador(entorno, `${request.method} ${pathname}`);
    if (pathname.startsWith('/api/')) {
      const respuesta = await api({ request, env, params: { ruta: pathname.slice(5).split('/').filter(Boolean) } });
      // Respaldo: si el cron de Cloudflare no corrió en los últimos 12 minutos, la pasada se hace ahora,
      // en segundo plano, aprovechando que alguien está usando el panel.
      if (pathname === '/api/resumen' || pathname.startsWith('/api/campanias')) {
        ctx.waitUntil((async () => {
          const conf = await leerConfig(env.DB);
          if (Number(conf.ultimo_tick || 0) < Date.now() - (CADA + 2 * 60e3)) await pasada(env, { base: env.BASE_URL || origin, origen: 'panel' });
        })().catch(() => {}).finally(() => informar(env)));
      } else informar(env);
      return respuesta;
    }
    let m;
    if ((m = pathname.match(/^\/o\/([^/]+)$/))) return apertura(env, m[1]);
    if ((m = pathname.match(/^\/l\/([^/]+)$/))) return clic(env, m[1]);
    if ((m = pathname.match(/^\/baja\/([^/]+)$/))) return baja(env, request, m[1]);
    if (pathname === '/privacidad') return privacidad(env);
    if (pathname === '/condiciones') return condiciones(env);
    return env.ASSETS.fetch(request);
  },

  // Cada 10 minutos: manda la tanda que toque, crea recordatorios, revisa rebotes y respuestas.
  async scheduled(evento, entorno) {
    const env = conContador(entorno, 'cron');
    const r = await pasada(env, { origen: 'cron' });
    informar(env);
    console.log(JSON.stringify(r));
  },
};
