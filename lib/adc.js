// Counterpicks da rota de ADC por classe (data/adc.json).
// Liga os nomes à lista oficial da Riot e entrega ao app as regras já conferidas.
import { join } from 'node:path';
import { DATA, readJSON } from './util.js';
import { makeResolver } from './names.js';

const FILE = join(DATA, 'adc.json');
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

// Devolve { classOf: { nome: classe }, classes, tabela, prioridades, magica, dano, avisos }
export async function loadAdc(champions) {
  const raw = await readJSON(FILE, {});
  const resolve = makeResolver(champions);
  const avisos = [];
  const classOf = {};
  const classes = Object.keys(raw.classes || {});
  for (const [cls, list] of Object.entries(raw.classes || {})) {
    for (const n of list || []) {
      const name = resolve(n);
      if (!name) { avisos.push(`adc.json: não reconheci "${n}" (${cls})`); continue; }
      classOf[name] = cls;
    }
  }
  const tabela = {};
  for (const a of classes) {
    tabela[a] = {};
    for (const b of classes) tabela[a][b] = num(raw.tabela?.[a]?.[b], 0);
  }
  const prioridades = {};
  for (const [k, v] of Object.entries(raw.prioridades || {})) {
    const [a, b] = k.split(/\s+x\s+/i).map((s) => s.trim());
    if (!classes.includes(a) || !classes.includes(b)) { avisos.push(`adc.json: confronto "${k}" usa uma classe que não existe`); continue; }
    const names = (l) => (l || []).map((n) => resolve(n) || (avisos.push(`adc.json: não reconheci "${n}" em "${k}"`), null)).filter(Boolean);
    prioridades[`${a} x ${b}`] = { priorize: names(v?.priorize), evite: names(v?.evite) };
  }
  const magica = classes.includes(raw.classe_magica) ? raw.classe_magica : null;
  const dano = { pouco_fisico: num(raw.dano?.pouco_fisico, 40), muito_fisico: num(raw.dano?.muito_fisico, 70) };
  if (avisos.length) console.warn(avisos.join('\n'));
  return { classOf, classes, tabela, prioridades, magica, dano, avisos };
}
