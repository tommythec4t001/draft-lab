// Fichas dos campeões: dano, estilo, curva de força, para quem perde e sinergias.
import { join } from 'node:path';
import { DATA, readJSON, writeJSON } from './util.js';
import { makeResolver } from './names.js';

const FILE = join(DATA, 'profiles.json');
export const ESTILOS = ['frente', 'engage', 'desengage', 'poke', 'pick', 'dive', 'peel', 'split', 'teamfight', 'cc'];
export const CURVAS = ['inicio', 'meio', 'fim'];
export const MINIMO = 3; // campeões mínimos em perde_para e em sinergia

const pct = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : null);

// Devolve { nomeDoCampeão: ficha } com todos os nomes já ligados à lista oficial da Riot.
export async function loadProfiles(champions) {
  const raw = await readJSON(FILE, {});
  const resolve = makeResolver(champions);
  const out = {};
  for (const [key, p] of Object.entries(raw)) {
    if (key.startsWith('_') || !p || typeof p !== 'object') continue;
    const name = resolve(key);
    if (!name) continue;
    const names = (list) => [...new Set((list || []).map(resolve).filter((n) => n && n !== name))];
    const ad = pct(p.ad);
    const vd = ad == null ? null : Math.min(pct(p.vd) ?? 0, 100 - ad);
    const perde = names(p.perde_para), sin = names(p.sinergia);
    out[name] = {
      ad, vd,
      estilo: (p.estilo || []).filter((e) => ESTILOS.includes(e)),
      curva: CURVAS.includes(p.curva) ? p.curva : 'meio',
      perde_para: perde,
      sinergia: sin,
      pendente: !!p.pendente || ad == null || perde.length < MINIMO || sin.length < MINIMO,
      marcado: !!p.pendente,
    };
  }
  return out;
}

// Grava a ficha de um campeão, mantendo o resto do arquivo como está.
export async function saveProfile(champions, name, data) {
  const resolve = makeResolver(champions);
  const target = resolve(name);
  if (!target) throw new Error('Campeão não encontrado.');
  const raw = await readJSON(FILE, {});
  const oldKey = Object.keys(raw).find((k) => !k.startsWith('_') && resolve(k) === target);
  if (oldKey && oldKey !== target) delete raw[oldKey];
  const list = (v) => (Array.isArray(v) ? v : String(v || '').split(','))
    .map((s) => String(s).trim()).filter(Boolean)
    .map((s) => resolve(s) || s);
  const ad = data.ad === null || data.ad === '' || data.ad === undefined ? null : pct(Number(data.ad));
  const vd = ad == null ? null : Math.min(pct(Number(data.vd)) ?? 0, 100 - ad);
  raw[target] = {
    ad,
    ...(vd ? { vd } : {}),
    estilo: (data.estilo || []).filter((e) => ESTILOS.includes(e)),
    curva: CURVAS.includes(data.curva) ? data.curva : 'meio',
    perde_para: list(data.perde_para),
    sinergia: list(data.sinergia),
  };
  if (data.pendente) raw[target].pendente = true;
  const faltam = [];
  if (raw[target].perde_para.length < MINIMO) faltam.push(`pelo menos ${MINIMO} campeões em "perde para"`);
  if (raw[target].sinergia.length < MINIMO) faltam.push(`pelo menos ${MINIMO} em "combina com"`);
  if (faltam.length && !data.pendente) throw new Error(`Faltam ${faltam.join(' e ')}. Complete ou marque a ficha como pendente para salvar assim.`);
  await writeJSON(FILE, raw);
  const unknown = [...list(data.perde_para), ...list(data.sinergia)].filter((n) => !resolve(n));
  return { name: target, unknown };
}
