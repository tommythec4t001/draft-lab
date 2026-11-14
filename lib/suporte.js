// Counterpicks por classe: suporte (data/suporte.json), topo (data/topo.json), meio (data/meio.json) e selva (data/selva.json), no mesmo formato.
// Liga os nomes à lista oficial da Riot e entrega ao app as regras já conferidas.
import { join } from 'node:path';
import { DATA, readJSON } from './util.js';
import { makeResolver } from './names.js';

const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

// Devolve { classOf: { nome: classe }, classes, grupos, tabela, excecoes, sinergia, duplas, notas, avisos }
export async function loadClassFile(file, champions) {
  const raw = await readJSON(join(DATA, file), {});
  const resolve = makeResolver(champions);
  const avisos = [];
  const name = (n, where) => { const r = resolve(n); if (!r) avisos.push(`${file}: não reconheci "${n}" (${where})`); return r; };
  const classOf = {};
  const classes = Object.keys(raw.classes || {});
  for (const [cls, list] of Object.entries(raw.classes || {})) for (const n of list || []) { const r = name(n, cls); if (r) classOf[r] = cls; }
  const grupos = {};
  for (const [g, list] of Object.entries(raw.grupos || {})) grupos[g] = (list || []).map((n) => name(n, g)).filter(Boolean);
  const tabela = {};
  for (const a of classes) { tabela[a] = {}; for (const b of classes) tabela[a][b] = num(raw.tabela?.[a]?.[b], 0); }
  const excecoes = [];
  for (const e of raw.excecoes || []) {
    const who = name(e.campeao, 'exceções');
    // "contra" pode ser campeão, grupo ou classe
    const kind = classes.includes(e.contra) ? 'classe' : grupos[e.contra] ? 'grupo' : 'campeao';
    const vs = kind === 'campeao' ? name(e.contra, 'exceções') : e.contra;
    if (who && vs) excecoes.push({ campeao: who, contra: vs, tipo: kind, valor: num(e.valor, 0) });
  }
  const sinergia = {};
  for (const [cls, list] of Object.entries(raw.sinergia_adc || {})) if (classes.includes(cls)) sinergia[cls] = list || [];
  const duplas = (raw.duplas_ruins || []).map((p) => (p || []).map((n) => name(n, 'duplas ruins'))).filter((p) => p.length === 2 && p.every(Boolean));
  const notas = {};
  for (const [cls, t] of Object.entries(raw.notas || {})) if (classes.includes(cls) && t) notas[cls] = String(t);
  if (avisos.length) console.warn(avisos.join('\n'));
  return { classOf, classes, grupos, tabela, excecoes, sinergia, duplas, notas, avisos };
}

export const loadSup = (champions) => loadClassFile('suporte.json', champions);
export const loadTop = (champions) => loadClassFile('topo.json', champions);
export const loadMid = (champions) => loadClassFile('meio.json', champions);
export const loadJg = (champions) => loadClassFile('selva.json', champions);
